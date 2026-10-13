# Context compaction

Long conversations eventually outgrow a model's context window. Pulpo compacts
them the way OpenAI Codex does: the model summarizes the conversation, and the
history it sees from then on is a few recent user messages plus that summary.
The same shared module (`apps/server/src/compaction/`) serves agent runs,
ordinary chat, and Codex-backed chat.

## When compaction runs

Compaction runs when the context reaches the model's auto-compact limit:

```
limit = min(compaction threshold, 90% of the context window)
```

The threshold is the per-model **Compaction threshold** setting. Values above
90% of the window are clamped by the formula. The Codex model settings
endpoint rejects new values above that maximum, and reports a stored value
above it as the maximum, so the settings dialog can still save. Compaction
never runs for a model with compaction turned off, or for a conversation with
no earlier history.

There are two phases:

- `pre_response`: before a new turn is sent, in all three paths. Like Codex,
  only the context before the new turn counts: the incoming message is neither
  counted nor summarized, and is sent after the compacted history. Agent runs
  make one exception: when the history is under the limit but the history plus
  the incoming message would exceed 95% of the window, the history is
  compacted first, so the new message reaches the model intact. In chat and
  Codex chat, that case shows up as a provider overflow, and the retry
  compacts the history and resends the message unchanged. An incoming message
  too large to fit on its own goes through
  [recovery](#recovery-from-context-overflows).
- `agent_mid_run`: between model turns of an agent run, when tool output has
  grown the live context past the limit.

## How tokens are counted

Pulpo counts a context as the provider-reported usage of the last real model
response, plus an estimate of only what was added since:

- **Agent runs:** the last successful assistant message with non-zero usage
  (`input + cacheRead + cacheWrite + output`), plus estimates of the messages
  after it.
- **Chat and Codex chat:** the parent response's usage (`inputTokens +
  outputTokens - reasoningTokens`), with nothing added for the new input.
  Reasoning is left out because earlier reasoning is not replayed: Codex
  history never includes it, chat does not request encrypted reasoning, and
  providers drop earlier reasoning at a new user turn. A public-API client
  that continues a tool call (`function_call_output` after
  `previous_response_id`) does get the parent's reasoning back, so that count
  runs low by up to one response's reasoning. Only completed non-agent
  responses count; agent usage adds up across turns, so it is not a context
  size.

When there is no usage to start from (the first turn, a turn right after
compaction, or replayed history), Pulpo estimates everything the model sees
before the new turn: system prompt, instructions, tools, fixed context, and
earlier messages.

Estimates follow Codex's rule of about four UTF-8 bytes per token, counted over
model-visible content only. Ids, timestamps, usage, and signatures are not
counted. An image counts as 1,844 tokens and an attached file as 2,000. Opaque
encrypted reasoning uses Codex's length formula. Unrecognized Responses items
count their full JSON, so new item kinds are never free.

Compaction items record which method produced the count in `token_source`
(`usage` or `estimate`). Each message's estimate is computed once and cached,
so re-counting a history while trimming it is cheap.

## The summary request

The summarizer is the chat's own model, sent the real conversation with the
same system prompt, tools, and prompt-cache identity as a normal turn, so the
provider can reuse the cached prefix. A summary prompt is appended as the final
user message. When tools are present the request sets `tool_choice: 'none'`.
Output is capped at `min(8,192, model max output tokens)`. Agent and Codex
requests ask for low reasoning effort. Agent requests clear the stored usage on
earlier assistant messages (usage is never sent, so the cached prefix is
unchanged); otherwise pi-ai would size the output cap from the last turn's
usage and could shrink it to a single token. Chat requests copy only the cache
parameters, instructions, and tools from the main request, so a structured
output format never applies to the summary.

Before sending, Pulpo drops the oldest exchanges until its estimate fits within
95% of the window minus that same output cap. Trimming is best effort: when
nothing more can be dropped and the estimate still does not fit, the
most-trimmed history is sent anyway and the provider's answer decides. Long
trims yield to the event loop every 32 drops so other requests on the worker
keep running. Retained user messages are still chosen from the full history.
If the provider still reports a context overflow, Pulpo drops the oldest
exchange (an assistant message with its tool results, a function call with its
output, or a single message) and retries, up to 32 times.

A leading user message is dropped last, only once nothing else is left. The
summary request then holds just the summary prompt, and the compacted history
still keeps that message, cut in the middle to the retained-token budget. This
is how a first message larger than the window can still be compacted.

## What is kept

After compaction the model sees:

1. Recent user messages, newest first, up to the retained-token budget. The
   oldest one kept is cut in the middle to fit, with a
   `…N tokens truncated…` marker.
2. One user message holding the summary, starting with Codex's
   summary prefix ("Another language model started to solve this problem…").

All assistant messages, tool calls, tool results, reasoning, images, and
attachments are dropped. Earlier summaries are never kept as user messages;
their content reaches the model through the new summary.

Agent runs skip a threshold compaction (`pre_response` or `agent_mid_run`)
without calling the summarizer when it could not save more than about one
summary's worth of history (2,000 tokens, or the summary output cap if that is
lower): the estimated history minus the user messages that would be kept. That
avoids billed summaries of short histories, for example under a very low
threshold.

In agent runs, a compacted context that is not smaller than the original
counts as no progress. A threshold compaction (`pre_response` or
`agent_mid_run`) then records a failed item and the run continues with the
uncompacted history, which may still fit the window. A forced compaction during
overflow recovery fails the run instead, which prevents a compaction loop. Chat
and Codex chat have no such check.

## Setting

**Kept user-message tokens** (`compactionRetainedUserTokens`, 0 to 100,000,
default 20,000) sets the retained-token budget. It is available in
**Admin → Models** and in the Codex model settings. Pulpo uses at most a
quarter of the auto-compact limit, so small-window models still shrink after
compaction.

Migration `0098_compaction_retained_user_tokens` adds the column. The old
`compaction_retained_turns` column is deprecated and unused, and is kept only so
pods running the previous release keep working during a rolling deploy. A
later migration will drop it.

## Recovery from context overflows

**Agent runs.** Before each model call, Pulpo checks the request against 95% of
the window. A larger request fails with `Request exceeds the context window
(estimated size N, limit M)`, which pi-ai classifies as a context overflow, just
like an overflow reported by the provider. The run then forces a compaction
and continues instead of failing. A second recovery needs a successful model
turn in between. After any recovery, ordinary retries and model fallback stay
off for the rest of the run. When recovery is not allowed (compaction is off,
or no successful turn since the last recovery), a context overflow ends the
run at once: no ordinary retry, no fallback, and no sticky fallback marking,
since resending or rerouting the same oversized request cannot help.

`agent_runs.context` stores `displayStart` and `archivedMessages` so a resumed
run renders the same output after a mid-run compaction. It also stores
`promptRecorded`, set once the run's prompt is in the saved messages (at the
prompt's `message_end`, and on every mid-run or recovery compaction). A resumed
run with the flag set continues instead of sending its prompt again, even when
a crash came right after a compaction reset `displayStart` to the compacted
length. For runs saved by older code, `displayStart` falls back to the parent
message count, the archive to empty, and the continue decision to comparing the
saved message count with `displayStart`. A resumed run also marks any
compaction item a crash left `in_progress` as failed ("Context compaction was
interrupted").

**Chat and Codex chat.** If the provider rejects a request as too long before
any output, Pulpo retries once with a forced compaction. This needs compaction
enabled and a response with history, and the response must not already carry a
completed compaction from that model.

**Codex error texts.** Codex treats any error text matching
`/auth|token|unauthorized|401/i` as an expired login and asks the user to
reconnect. Compaction and context-overflow failures therefore never reach that
check. Pulpo's own texts mention "compaction" or "context window" and never
"token". Agent runs skip the check for any compaction or overflow failure,
including provider overflow texts that mention tokens, and show Pulpo's
compaction text or "The conversation exceeds the model context window." Codex
chat compacts before the code that runs the check, and replaces a main-request
overflow text with a fixed message before it. A Codex summarizer request that
fails for another reason is handled where it fails: a real expired login is
marked for reconnection there, and the request fails with `Context compaction
failed:` followed by the redacted Codex message.

## Billing

Each summarizer attempt, including overflow retries, is billed as an internal
model call with purpose `compaction`. Its cost is added to the response's
sidecar cost, which is settled with the response on completion, failure, or
cancellation. In chat and Codex chat, a retried attempt reuses a completed
compaction item from the same model instead of summarizing and billing again.

Before it starts, each attempt extends the response's budget hold by its own
estimated cost (request plus the summary output cap). An attempt that fails,
such as one the provider rejects as too long, is not billed and gives back
exactly its own extension under the reservation lock. Overflow retries
therefore hold one attempt at a time instead of adding up until the user's
balance runs out. See [Budget reservations](./budget-reservations.md).

## Compaction items

Each compaction appears in the response output as a `pulpo_compaction` item,
published as `pulpo.compaction.updated` events while it runs
(`in_progress` → `completed` or `failed`). New items set:

- `strategy: 'user_messages'`
- `estimated_tokens`: tokens before compaction, without the incoming message
- `token_source`: `usage` or `estimate`
- `threshold_tokens`: the auto-compact limit used
- `tokens_after`: estimated tokens of the compacted context, likewise without
  the incoming message
- `retained_turns`: the kept user messages, as `{ role: 'user', content }`
- `summary`: the raw summary, without the prefix
- `retained_context: []` and `retained_context_turns: []`, for older clients

Ids are `<responseId>:compaction:pre_response` for chat,
`<responseId>:compaction:pre_response:0` for agent runs, and
`<responseId>:compaction:agent_mid_run:<n>` for mid-run agent compactions. The
web chat shows "Context: before → after tokens" when both counts are present.

A later turn rebuilds its history from the newest completed, non-agent
response with a completed `pre_response` item. It sends the retained user
messages and the summary, then every response from the checkpoint response
onward.

## Legacy items

Items written before this design have no `strategy` and are still read:

- **Chat:** a developer message `Summary of earlier conversation:` followed by
  the item's `retained_context_turns`, then responses from the checkpoint
  onward.
- **Codex chat:** a user message `Earlier conversation summary:` followed by
  responses after `covered_through_response_id`.
- **Agent runs:** stored `[Compacted context]` handoff messages, like the other
  legacy summary prefixes, are recognized as summaries and never kept as
  user messages.

Agent checkpoints and failed responses are never used as chat checkpoints.
