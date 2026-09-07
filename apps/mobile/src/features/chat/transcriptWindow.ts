export const INITIAL_TRANSCRIPT_ROWS = 1
export const SHORT_TRANSCRIPT_ROWS = 8

type Row = { id: string }
const reversedTranscripts = new WeakMap<readonly Row[], Row[]>()

/** Short conversations keep their existing top alignment and keyboard spacing. */
export function usesBottomAnchoredTranscript(messages: readonly Row[]): boolean {
  return messages.length > SHORT_TRANSCRIPT_ROWS
}

/**
 * FlatList's inverted coordinates start at the latest message. Older virtualized
 * cells extend away from the viewport instead of being prepended above it.
 * Reverse only the list adapter, preserving document order and message identity.
 */
export function transcriptListMessages<T extends Row>(messages: T[]): T[] {
  if (!usesBottomAnchoredTranscript(messages)) return messages
  let reversed = reversedTranscripts.get(messages)
  if (!reversed) {
    reversed = messages.slice().reverse()
    reversedTranscripts.set(messages, reversed)
  }
  return reversed as T[]
}

// Native Markdown commits are not preemptible. Keep exceptionally large initial
// messages off the spring's UI-thread path; this is not a cache or decode gate.
export const LARGE_INITIAL_MESSAGE_CHARACTERS = 24_000
export function hasLargeInitialMessage(messages: readonly { text: string }[]): boolean {
  return (messages.at(-1)?.text.length ?? 0) > LARGE_INITIAL_MESSAGE_CHARACTERS
}
