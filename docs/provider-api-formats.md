# Provider API formats

Every provider connection has an **API format**: the protocol Pulpo uses for
text generation with that provider. Pulpo builds each request in one internal
shape and translates it for the provider. Chats, Agent mode, titles, OCR,
compaction, and every public API endpoint work the same whichever format a
provider uses.

| Format | Endpoint called | Typical providers |
| --- | --- | --- |
| **OpenAI Responses** (default) | `POST {base}/responses` | OpenAI, Azure OpenAI, Fireworks, other Responses-compatible gateways |
| **OpenAI Chat Completions** | `POST {base}/chat/completions` | vLLM, Ollama, llama.cpp, Groq, OpenRouter, DeepSeek, Together, most self-hosted servers |
| **Anthropic Messages** | `POST {base}/messages` | Anthropic, Claude through Anthropic-compatible gateways, other providers with Anthropic-compatible endpoints |

Apply migration `0092_provider_api_format.sql` with `npm run db:migrate`.
Existing providers keep the Responses format.

## Configure a provider

Under **Admin → Providers**, choose the **API format** when adding or editing a
provider. The base URL includes the version path, as with OpenAI:

- Anthropic: `https://api.anthropic.com/v1`
- A Chat Completions server such as vLLM: `http://vllm.internal:8000/v1`

The provider health check and **Refresh models** use the provider's own model
listing. For Anthropic-format providers, Pulpo sends `x-api-key` and
`anthropic-version` and follows Anthropic's model-list pagination.

Changing a provider's format takes effect for the next request. A background
generation interrupted by a worker restart resumes only on Responses
providers. Other formats regenerate the answer from the stored request.

## How requests are translated

Pulpo always sends the provider's required fields and drops options that have
no equivalent in its protocol. When a provider rejects an optional parameter
with HTTP 400 or 422 and says it is unsupported (for example `temperature`,
`reasoning_effort`, or `thinking`), Pulpo retries without it. Other request
errors, such as an invalid JSON schema, reach the caller unchanged. A Chat
Completions server that rejects `max_tokens` is retried once with
`max_completion_tokens`, and the reverse.

A stream that ends before the provider reports a finish reason is treated as a
failed generation, not a complete answer. Tokens the provider reported before
the failure are still billed.

**Chat Completions**

- System prompts, custom instructions, memory, and the compaction summary are
  combined into one leading `system` message, because many chat templates
  accept only one.
- `reasoning.effort` becomes `reasoning_effort`. Reasoning streamed as
  `reasoning_content` or `reasoning` appears as model thinking in chats. It is
  not sent back on later turns.
- Uploaded files are sent inline. Text files become text and PDFs become `file`
  parts, so the server must support them.
- Usage is read from the final stream chunk, including cached prompt tokens and
  OpenRouter's reported `cost` when the model uses provider cost. Pulpo always
  requests it with `stream_options.include_usage`. If a server never reports
  usage, Pulpo estimates it from the request and generated text and logs
  `upstream.usage_missing`.
- On tool-calling turns, reasoning the same model produced is sent back as
  `reasoning_content`, which thinking models such as DeepSeek and Kimi require.
- In Agent mode on servers other than OpenAI's, instructions use the `system`
  role and the output limit uses `max_tokens`. `reasoning_effort` is sent only
  when the model is configured with a reasoning effort.

**Anthropic Messages**

- Claude models that support adaptive thinking get `thinking: {type: "adaptive"}`
  with `output_config.effort`. Older models, and other models behind an
  Anthropic-compatible endpoint, get `budget_tokens`. Effort levels the model
  does not accept fall back to the nearest one it does.
- Custom `temperature` and `top_p` are omitted where the model rejects them
  (Claude Opus 4.7 and later, Sonnet 5 and later) and whenever thinking is on.
  `temperature` is clamped to Anthropic's 0–1 range.
- Forced tool use (`tool_choice` `required` or a named function) is sent only
  where Anthropic allows it. Thinking is disabled for that request on models
  that think by default. Requests that ask for thinking, and models that always
  think (Opus 5.5, Sonnet 5.5, Fable), use `auto` instead.
- Thinking blocks and their signatures are stored with each answer and replayed,
  in their original order, on later turns to the same model. If the provider rejects a replayed
  signature, for example after compaction rewrites history, Pulpo retries once
  without thinking blocks.
- Enabling **Prompt caching** on a model sends top-level
  `cache_control: {type: "ephemeral"}`. Anthropic then caches the longest
  reusable prefix. Agent mode places explicit cache breakpoints. Cache reads
  and writes are billed with the model's cached-input and cache-write prices.
- PDFs and text files are sent as `document` blocks.

Default parameters that are not part of the Responses API pass straight
through, so you can set provider-specific knobs on a model. Examples are
`top_k` or `repetition_penalty` for a vLLM model, or a `thinking`
configuration for a Claude model that has no reasoning effort set. They fill
only fields Pulpo leaves unset. The output limit, messages, system prompt,
and tool choice always come from Pulpo. If a provider says a
pass-through parameter is unsupported, Pulpo retries without it.

## Anthropic-compatible public API

Alongside the OpenAI-compatible endpoints, API keys can call:

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/messages` | Anthropic Messages, streaming and non-streaming |
| `POST /v1/messages/count_tokens` | Estimated input tokens for a Messages request |
| `GET /v1/models` | With an `anthropic-version` header, returns Anthropic's model-list shape |

Point an Anthropic SDK at the instance root with a Pulpo API key:

```ts
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ baseURL: 'https://pulpo.example.com', apiKey: process.env.PULPO_API_KEY })
const message = await client.messages.create({
  model: 'your-model-id',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
})
```

Keys are accepted in either `x-api-key` or `Authorization: Bearer`. Any catalog
model can serve these requests, whatever its provider's format. The reverse
also holds: Claude models can serve OpenAI-compatible clients.

Requests may be up to 32 MB, matching Anthropic. Streams send a `ping` event
every 15 seconds while a model is working silently.

Supported request features:

- Text, base64 or URL images, and system prompts.
- Base64 or URL PDF documents and text documents. Document URLs reach
  Responses and Anthropic providers directly. Chat Completions providers see a
  reference instead.
- Search results, tool references, and client-side compaction summaries, which
  are passed on as text.
- Custom tools, `tool_choice` (`auto`, `any`, `tool`, `none`), and
  `disable_parallel_tool_use`.
- `thinking` (`enabled` or `adaptive`) and `output_config.effort`.
- `output_config.format` JSON schemas, `temperature`, and `top_p`.
- `metadata.user_id`, which becomes the safety identifier.

Responses include `thinking` blocks only when the request enabled thinking.
Signatures are present when the model behind the endpoint is an Anthropic
model, so you can send the blocks back unchanged.

Accepted but ignored: `stop_sequences`, `top_k`, `service_tier`, `container`,
`context_management`, `inference_geo`, `speed`, and `cache_control`.
Anthropic-hosted server tools (web search, code execution, and others) are
also ignored, so clients that always advertise them still work. Their custom
tools are kept. `max_tokens: 0` (cache pre-warming) generates a single token.

Rejected with HTTP 400: `mcp_servers` and file-ID sources.

Errors use Anthropic's `{"type": "error", "error": {...}}` envelope, so SDK
error classes work as usual. Upstream overloads become `overloaded_error`
(529) and rate limits become `rate_limit_error` (429), so clients back off and
retry as they would with Anthropic. `count_tokens` returns an estimate, because Pulpo
serves models with different tokenizers.
