import { MAX_MESSAGE_FILE_REFERENCES, type FileReference } from '@pulpo/contracts'

/**
 * Typing `@` in the message box searches Files right there. Choosing an item puts its name in the
 * text as plain words and adds it to the draft's references, as "Add from Files…" does, so the sent
 * message is the same as typing the name and picking the item: nothing about the mention itself is
 * stored. These work on the typed text only; composers split the references off before showing it.
 */

/** The `@word` being typed: `text.slice(start, end)` is the whole token, `query` what follows `@` up to the caret. */
export interface FileMentionToken {
  start: number
  end: number
  query: string
}

/** How many suggestions the composer lists at once. */
export const FILE_MENTION_SUGGESTIONS = 8

const WHITESPACE = /\s/u

/**
 * The `@` token the caret is in, if any. A token starts with `@` at the start of the text or after
 * whitespace and runs to the next whitespace, so `a@b.com` never counts and a name with spaces is
 * found by its first word. `caret` is a collapsed selection; with a range selected there is none.
 */
export function activeFileMention(text: string, caret: number, selectionEnd = caret): FileMentionToken | null {
  if (selectionEnd !== caret || caret < 0 || caret > text.length) return null
  let start = caret
  while (start > 0 && !WHITESPACE.test(text[start - 1]!)) start -= 1
  if (text[start] !== '@' || start === caret) return null
  let end = caret
  while (end < text.length && !WHITESPACE.test(text[end]!)) end += 1
  return { start, end, query: text.slice(start + 1, caret) }
}

/**
 * The text with `token` replaced by `name` and a space, and where the caret goes: just after that
 * space. When whitespace already follows the token it is reused rather than doubled.
 */
export function applyFileMention(text: string, token: FileMentionToken, name: string): { text: string; caret: number } {
  const before = text.slice(0, token.start)
  const after = text.slice(token.end)
  const spaced = WHITESPACE.test(after[0] ?? '')
  const next = `${before}${name}${spaced ? '' : ' '}${after}`
  return { text: next, caret: before.length + name.length + 1 }
}

/**
 * The suggestions to list: items the draft doesn't already mention, at most `limit`, and none once
 * the message mentions as many items as one can carry.
 */
export function fileMentionSuggestions<T extends { id: string }>(
  items: readonly T[],
  references: readonly Pick<FileReference, 'id'>[],
  limit = FILE_MENTION_SUGGESTIONS,
): T[] {
  if (references.length >= MAX_MESSAGE_FILE_REFERENCES) return []
  const mentioned = new Set(references.map((reference) => reference.id.toLowerCase()))
  return items.filter((item) => !mentioned.has(item.id.toLowerCase())).slice(0, limit)
}

/** How many results to ask the server for, so that leaving out mentioned items still fills the list. */
export function fileMentionRequestLimit(references: readonly unknown[], limit = FILE_MENTION_SUGGESTIONS): number {
  return Math.min(MAX_MESSAGE_FILE_REFERENCES, limit + references.length)
}

/** Tells one token from another, so dismissing the list with Escape lasts until that token is gone. */
export function fileMentionKey(token: FileMentionToken | null): string | null {
  return token ? String(token.start) : null
}
