import { composerReferences, withComposerReferences } from '@pulpo/client-core/files'
import { appendDraftText } from '../quiz/composer'

/**
 * A draft keeps its Files references as its last paragraph of links (see composerReferences); the
 * message field shows only the typed text before them. These edit that text and keep the links.
 */

/** The draft after the field's text became `text`. */
export function withComposerText(draft: string, text: string): string {
  return withComposerReferences(text, composerReferences(draft).references)
}

/** The draft with `text` added after what was typed, before its references. */
export function appendComposerText(draft: string, text: string): string {
  const { text: typed, references } = composerReferences(draft)
  return withComposerReferences(appendDraftText(typed, text), references)
}

/** Where the field's text ends, for placing the cursor at the end of a draft. */
export function composerTextEnd(draft: string): number {
  return composerReferences(draft).text.length
}

/** A queued or shelved message's text without its Files references, which its detail names. */
export function draftPreviewText(content: string): string {
  const { text, references } = composerReferences(content)
  return text.trim() || (references.length ? references.map((reference) => reference.name).join(', ') : 'Attachments')
}

/** The Files items a queued or shelved message mentions, for its detail (none when the text names them). */
export function draftReferenceNames(content: string): string[] {
  const { text, references } = composerReferences(content)
  return text.trim() ? references.map((reference) => reference.name) : []
}
