/** Codex's compact/prompt.md, plus identifier preservation and a no-tools instruction. */
export const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

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
