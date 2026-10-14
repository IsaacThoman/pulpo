import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transform } from '@tiptap/pm/transform'

/**
 * Inline suggestions: proposed changes stored in the document itself, Google Docs style.
 *
 * - Inserted inline content carries the `suggestionInsert` mark and deleted inline content the
 *   `suggestionDelete` mark, each with `{ id, changeId }`.
 * - Whole inserted or deleted blocks carry the `suggestion` block attribute instead, encoded as
 *   `"<kind>|<changeId>|<id>"` (see `formatBlockSuggestion`).
 * - `id` names one hunk (what Accept or Reject acts on); `changeId` is the `file_changes` row
 *   (one agent reply's changes to one document).
 *
 * The base view rejects every suggestion (what the document says until someone accepts);
 * the proposed view accepts every suggestion (what the agent sees and edits).
 */

export const SUGGESTION_INSERT_MARK = 'suggestionInsert'
export const SUGGESTION_DELETE_MARK = 'suggestionDelete'
export const SUGGESTION_BLOCK_ATTR = 'suggestion'

export type SuggestionKind = 'insert' | 'delete'
export type SuggestionAction = 'accept' | 'reject'
export type DocView = 'base' | 'proposed'

export interface SuggestionRef {
  id: string
  changeId: string
  kind: SuggestionKind
}

/** One hunk: its insertions and deletions, which Accept or Reject resolve together. */
export interface SuggestionHunk {
  id: string
  changeId: string
  /** Inserted and deleted text, for previews and counts. */
  inserted: string
  deleted: string
  /** Document position of the hunk's first piece. */
  from: number
  to: number
}

export function formatBlockSuggestion(ref: SuggestionRef): string {
  return `${ref.kind}|${ref.changeId}|${ref.id}`
}

export function parseBlockSuggestion(value: unknown): SuggestionRef | null {
  if (typeof value !== 'string') return null
  const [kind, changeId, id] = value.split('|')
  if ((kind !== 'insert' && kind !== 'delete') || !changeId || !id) return null
  return { kind, changeId, id }
}

/** Every unresolved hunk in document order. */
export function listSuggestions(_doc: ProseMirrorNode): SuggestionHunk[] {
  throw new Error('Not implemented')
}

/**
 * Accepts or rejects the hunks `match` selects, appending steps to `tr` (an editor transaction
 * or a plain Transform on the server). Accepting an insertion or rejecting a deletion keeps the
 * content and drops the marker; the other two remove the content.
 */
export function resolveSuggestions<T extends Transform>(_tr: T, _match: (ref: SuggestionRef) => boolean, _action: SuggestionAction): T {
  throw new Error('Not implemented')
}

/** The document with every suggestion rejected (`base`) or accepted (`proposed`). */
export function docView(doc: ProseMirrorNode, _view: DocView): ProseMirrorNode {
  return doc
}

export interface MergeMarkdownResult {
  doc: ProseMirrorNode
  /** False when the proposed view already matched the Markdown. */
  changed: boolean
  /** New hunks this merge proposed (Suggest mode) or applied (Write mode). */
  hunks: number
}

/**
 * Rewrites `current` so that its proposed view becomes `markdown`, leaving every part the
 * Markdown does not change exactly as it was (other suggestions included).
 *
 * - `suggest`: new insertions and deletions become suggestions tagged with `changeId`.
 * - `write`: they apply directly.
 *
 * Either way, content an earlier suggestion inserted and the Markdown drops is removed outright,
 * and content an earlier suggestion deletes stays where it is.
 */
export function mergeMarkdown(
  _current: ProseMirrorNode,
  _markdown: string,
  _options: { mode: 'suggest' | 'write'; changeId: string; newId?: () => string },
): MergeMarkdownResult {
  throw new Error('Not implemented')
}
