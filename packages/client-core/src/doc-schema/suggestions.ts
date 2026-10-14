import { Extension, Mark, mergeAttributes, type AnyExtension } from '@tiptap/core'
import type { Mark as ProseMirrorMark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'

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
export function listSuggestions(doc: ProseMirrorNode): SuggestionHunk[] {
  const hunks = new Map<string, SuggestionHunk>()
  // Where each hunk's previous insert or delete piece sat, to put line breaks between blocks.
  const lastBlock = new Map<string, number>()
  // A block suggestion's text already includes everything inside it.
  const coveredUntil = new Map<string, number>()
  const add = (ref: SuggestionRef, text: string, from: number, to: number, block: number) => {
    if (from < (coveredUntil.get(ref.id) ?? -1)) return
    let hunk = hunks.get(ref.id)
    if (!hunk) hunks.set(ref.id, hunk = { id: ref.id, changeId: ref.changeId, inserted: '', deleted: '', from, to })
    hunk.to = Math.max(hunk.to, to)
    const field = ref.kind === 'insert' ? 'inserted' : 'deleted'
    const key = `${ref.kind}|${ref.id}`
    if (hunk[field] && lastBlock.get(key) !== block) hunk[field] += '\n'
    hunk[field] += text
    lastBlock.set(key, block)
  }
  doc.descendants((node, pos) => {
    const block = parseBlockSuggestion(node.attrs[SUGGESTION_BLOCK_ATTR])
    if (block) {
      add(block, node.textBetween(0, node.content.size, '\n', '\n'), pos, pos + node.nodeSize, pos)
      coveredUntil.set(block.id, Math.max(coveredUntil.get(block.id) ?? -1, pos + node.nodeSize))
    }
    const ref = node.isInline ? inlineSuggestion(node) : null
    if (ref) add(ref, node.isText ? node.text ?? '' : node.type.spec.leafText?.(node) ?? '\n', pos, pos + node.nodeSize, doc.resolve(pos).start())
    return true
  })
  return [...hunks.values()]
}

/** Accepting an insertion or rejecting a deletion keeps the content; the other two remove it. */
function removesContent(kind: SuggestionKind, action: SuggestionAction): boolean {
  return (kind === 'insert') === (action === 'reject')
}

/**
 * Accepts or rejects the hunks `match` selects, appending steps to `tr` (an editor transaction
 * or a plain Transform on the server). Accepting an insertion or rejecting a deletion keeps the
 * content and drops the marker; the other two remove the content.
 */
export function resolveSuggestions<T extends Transform>(tr: T, match: (ref: SuggestionRef) => boolean, action: SuggestionAction): T {
  const unmark: Array<{ from: number; to: number; mark: ProseMirrorMark }> = []
  const clear: number[] = []
  const remove: Array<{ from: number; to: number; block: boolean }> = []
  tr.doc.descendants((node, pos) => {
    const block = parseBlockSuggestion(node.attrs[SUGGESTION_BLOCK_ATTR])
    if (block && match(block)) {
      if (removesContent(block.kind, action)) {
        remove.push({ from: pos, to: pos + node.nodeSize, block: true })
        return false
      }
      clear.push(pos)
    }
    if (!node.isInline) return true
    const to = pos + node.nodeSize
    for (const mark of node.marks) {
      const ref = suggestionFromMark(mark)
      if (!ref || !match(ref)) continue
      if (removesContent(ref.kind, action)) {
        const last = remove.at(-1)
        if (last && !last.block && last.to === pos) last.to = to
        else remove.push({ from: pos, to, block: false })
      } else {
        const last = unmark.at(-1)
        if (last && last.to === pos && last.mark.eq(mark)) last.to = to
        else unmark.push({ from: pos, to, mark })
      }
    }
    return true
  })
  // Neither of these moves positions, so the removals below can still use the ones collected.
  for (const { from, to, mark } of unmark) tr.removeMark(from, to, mark)
  for (const pos of clear) tr.setNodeAttribute(pos, SUGGESTION_BLOCK_ATTR, null)
  const start = tr.steps.length
  for (const { from, to, block } of remove.reverse()) {
    const mapping = tr.mapping.slice(start)
    const range = { from: mapping.map(from, 1), to: mapping.map(to, -1) }
    if (range.from >= range.to) continue
    // deleteRange also removes a container the block was the only child of, keeping it valid.
    if (block) tr.deleteRange(range.from, range.to)
    else tr.delete(range.from, range.to)
  }
  return tr
}

/** The document with every suggestion rejected (`base`) or accepted (`proposed`). */
export function docView(doc: ProseMirrorNode, view: DocView): ProseMirrorNode {
  if (!hasSuggestions(doc)) return doc
  return resolveSuggestions(new Transform(doc), () => true, view === 'base' ? 'reject' : 'accept').doc
}

export interface MergeMarkdownResult {
  doc: ProseMirrorNode
  /** False when the proposed view already matched the Markdown. */
  changed: boolean
  /** New hunks this merge proposed (Suggest mode) or applied (Write mode). */
  hunks: number
}

/** Rewrites a document so its proposed view reads like pushed Markdown; see merge.ts. */
export { mergeMarkdown } from './merge.js'
