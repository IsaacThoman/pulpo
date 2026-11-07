/** Codex's compact/prompt.md, plus identifier preservation, answered requests and a no-tools instruction. */
export const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue
- Which of the user's requests have already been answered, so they are not answered again

Be concise, structured, and focused on helping the next LLM seamlessly continue the work. Preserve exact file paths, commands, error messages, URLs, and identifiers. Reply with the summary only; do not call any tools.`

/** Codex's compact/summary_prefix.md, verbatim. */
export const SUMMARY_PREFIX = 'Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:'

/** Summaries written by the previous compaction implementations. */
export const LEGACY_SUMMARY_PREFIXES: readonly string[] = [
  '[Compacted context]',
  'Earlier conversation summary:',
  'Summary of earlier conversation:',
]

export function summaryMessageText(summary: string): string {
  return `${SUMMARY_PREFIX}\n${summary.trim()}`
}

export function isSummaryText(text: string): boolean {
  const start = text.trimStart()
  return start.startsWith(SUMMARY_PREFIX) || LEGACY_SUMMARY_PREFIXES.some((prefix) => start.startsWith(prefix))
}

/** The summary a summary message carries, without the prefix. */
export function summaryFromMessageText(text: string): string | undefined {
  const start = text.trimStart()
  return start.startsWith(SUMMARY_PREFIX) ? start.slice(SUMMARY_PREFIX.length).trim() : undefined
}

/**
 * One message standing in for a compacted head (retained user messages, then the summary).
 * Codex models are trained on the bare head, but other models read the run of user messages
 * as open requests, all the more when a provider merges them with the next prompt into one
 * turn. Here they are labeled as already handled; a failed turn counts too, and the summary
 * says how it went. The newest one is still in progress when the head ends the history or
 * assistant work follows it (a mid-run agent compaction).
 */
export function compactedContextText(options: { retained: readonly string[]; summary: string; lastInProgress: boolean }): string {
  const { retained, summary } = options
  const parts = ['The earlier part of this conversation was compacted to save context. This message stands in for it; it is not a new message from the user.']
  if (retained.length) {
    parts.push(
      "The user's earlier messages, oldest first:",
      ...retained.map((text) => `<earlier_user_message>\n${text}\n</earlier_user_message>`),
      options.lastInProgress
        ? (retained.length > 1
            ? 'All but the last of these messages were already handled earlier in the conversation, and the summary below says what was done; do not answer them again. The last one is the request that was being worked on when the conversation was compacted.'
            : 'This is the request that was being worked on when the conversation was compacted.')
        : 'All of these messages were already handled earlier in the conversation, and the summary below says what was done; do not answer them again.',
    )
  }
  parts.push(`Summary of the conversation so far:\n<conversation_summary>\n${summary.trim()}\n</conversation_summary>`)
  parts.push(options.lastInProgress
    ? 'The messages after this one continue from where the conversation was compacted.'
    : "Use this only as background. Reply to the user's next message.")
  return parts.join('\n\n')
}

/**
 * Fold a compacted head at the start of a history into one compactedContextText message.
 * Anything else, including a history already rendered, comes back unchanged.
 */
export function renderCompactedHead<T>(items: readonly T[], adapter: {
  /** Text of a user message, or undefined for any other item. */
  userText: (item: T) => string | undefined
  /** A user text message built from the summary item it replaces. */
  message: (text: string, summaryItem: T) => T
}): T[] {
  const retained: string[] = []
  for (let index = 0; index < items.length; index += 1) {
    const text = adapter.userText(items[index]!)
    if (text === undefined) break
    const summary = summaryFromMessageText(text)
    if (summary === undefined) {
      retained.push(text)
      continue
    }
    const rest = items.slice(index + 1)
    const lastInProgress = rest.length === 0 || adapter.userText(rest[0]!) === undefined
    return [adapter.message(compactedContextText({ retained, summary, lastInProgress }), items[index]!), ...rest]
  }
  return [...items]
}
