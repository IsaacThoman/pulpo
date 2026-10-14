import { Extension, Mark, mergeAttributes, type AnyExtension } from '@tiptap/core'
import type { Mark as ProseMirrorMark, Node as ProseMirrorNode } from '@tiptap/pm/model'
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

/** Every block node type, so a suggestion can insert or delete any of them whole. */
const SUGGESTION_BLOCK_TYPES = [
  'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
  'codeBlock', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader',
]

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
  /** Document position where the hunk's last piece ends. */
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

/** The suggestion an inline mark stands for, if it is a suggestion mark. */
export function suggestionFromMark(mark: ProseMirrorMark): SuggestionRef | null {
  const kind = mark.type.name === SUGGESTION_INSERT_MARK ? 'insert' : mark.type.name === SUGGESTION_DELETE_MARK ? 'delete' : null
  const { id, changeId } = mark.attrs
  return kind && typeof id === 'string' && typeof changeId === 'string' ? { kind, changeId, id } : null
}

function suggestionMark(name: string, className: string) {
  return Mark.create({
    name,
    // Typing next to a suggestion is the user's own text, not part of it.
    inclusive: false,
    excludes: `${SUGGESTION_INSERT_MARK} ${SUGGESTION_DELETE_MARK}`,
    addAttributes() {
      return {
        id: { default: null, renderHTML: (attrs) => ({ 'data-suggestion-id': attrs.id }) },
        changeId: { default: null, renderHTML: (attrs) => ({ 'data-change-id': attrs.changeId }) },
      }
    },
    // No parseHTML: pasted or imported HTML must never smuggle in suggestions.
    renderHTML({ HTMLAttributes }) {
      return ['span', mergeAttributes({ class: className }, HTMLAttributes), 0]
    },
  })
}

/** The suggestion marks and block attribute; part of `createDocExtensions()`. */
export function createSuggestionExtensions(): AnyExtension[] {
  return [
    suggestionMark(SUGGESTION_INSERT_MARK, 'pulpo-suggestion-insert'),
    suggestionMark(SUGGESTION_DELETE_MARK, 'pulpo-suggestion-delete'),
    Extension.create({
      name: 'suggestionBlocks',
      addGlobalAttributes() {
        return [{
          types: SUGGESTION_BLOCK_TYPES,
          attributes: {
            [SUGGESTION_BLOCK_ATTR]: {
              default: null,
              // Splitting a suggested block starts a block of the user's own.
              keepOnSplit: false,
              parseHTML: () => null,
              renderHTML: (attrs) => {
                const ref = parseBlockSuggestion(attrs[SUGGESTION_BLOCK_ATTR])
                return ref ? { 'data-suggestion': ref.kind, 'data-suggestion-id': ref.id, 'data-change-id': ref.changeId } : {}
              },
            },
          },
        }]
      },
    }),
  ]
}

function inlineSuggestion(node: ProseMirrorNode): SuggestionRef | null {
  for (const mark of node.marks) {
    const ref = suggestionFromMark(mark)
    if (ref) return ref
  }
  return null
}

/** Whether `node` or anything inside it carries a suggestion. */
export function hasSuggestions(node: ProseMirrorNode): boolean {
  if (parseBlockSuggestion(node.attrs[SUGGESTION_BLOCK_ATTR]) || inlineSuggestion(node)) return true
  let found = false
  node.descendants((child) => {
    if (found) return false
    found = !!parseBlockSuggestion(child.attrs[SUGGESTION_BLOCK_ATTR]) || !!inlineSuggestion(child)
    return !found
  })
  return found
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
