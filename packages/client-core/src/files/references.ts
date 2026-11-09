import { appendFileReferences, fileReferenceMarkdown, splitFileReferences, type FileReference } from '@pulpo/contracts'

/**
 * Composers keep a message's Files references in its draft text, as the last paragraph of links
 * the sent message carries, so synced drafts, shelved drafts, queued messages, and edits keep them
 * without anything of their own. The composer shows that paragraph as chips; these helpers split
 * it off and put it back without touching what the user typed.
 */
export function composerReferences(draft: string): { text: string; references: FileReference[] } {
  const breakAt = draft.lastIndexOf('\n\n')
  const split = splitFileReferences(draft)
  if (!split.references.length) return { text: draft, references: [] }
  // splitFileReferences trims; the typed text is kept exactly as it is.
  return { text: breakAt < 0 ? '' : draft.slice(0, breakAt), references: split.references }
}

/** The draft holding `text` and `references`; joined exactly so composerReferences gives both back. */
export function withComposerReferences(text: string, references: readonly FileReference[]): string {
  const unique = references.filter((reference, index) => references.findIndex((other) => other.id === reference.id) === index)
  if (!unique.length) return text
  return `${text}\n\n${unique.map(fileReferenceMarkdown).join(' ')}`
}

/** Adds references to a draft, after any it has. */
export function addComposerReferences(draft: string, added: readonly FileReference[]): string {
  const { text, references } = composerReferences(draft)
  return withComposerReferences(text, [...references, ...added])
}

/** The draft without the reference `id`. */
export function removeComposerReference(draft: string, id: string): string {
  const { text, references } = composerReferences(draft)
  return withComposerReferences(text, references.filter((reference) => reference.id !== id))
}

/** The text a message is sent with: what was typed, then its references. */
export function composerMessageText(draft: string): string {
  const { text, references } = composerReferences(draft)
  return appendFileReferences(text.trim(), references).trim()
}
