import { approxTokenCount, truncateMiddleToTokens } from './truncate.js'

export type RetainedUserMessage = { text: string; truncated: boolean }

/** Codex build_compacted_history_with_limit: newest user messages first, the oldest kept one middle-truncated to fit. */
export function selectRetainedUserMessages(texts: string[], budgetTokens: number): RetainedUserMessage[] {
  const selected: RetainedUserMessage[] = []
  let remaining = Math.max(0, Math.floor(budgetTokens))
  for (let index = texts.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const text = texts[index]!
    if (!text.trim()) continue
    const tokens = approxTokenCount(text)
    if (tokens > remaining) {
      selected.push({ text: truncateMiddleToTokens(text, remaining), truncated: true })
      break
    }
    selected.push({ text, truncated: false })
    remaining -= tokens
  }
  return selected.reverse()
}
