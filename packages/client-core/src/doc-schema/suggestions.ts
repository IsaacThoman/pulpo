import { Extension, Mark, mergeAttributes, type AnyExtension } from '@tiptap/core'
import { Fragment, type Mark as ProseMirrorMark, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Transaction } from '@tiptap/pm/state'
import { ReplaceStep, StepMap, type Transform } from '@tiptap/pm/transform'

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

interface Resolution {
  match: (ref: SuggestionRef) => boolean
  action: SuggestionAction
  /**
   * How positions move, as StepMap ranges (start, old size, new size) in the original
   * document, in order. Marker changes do not move anything.
   */
  ranges?: number[]
}

/**
 * The content of `node` (which starts at `start`) with the selected suggestions resolved, or
 * the very same fragment when nothing in it changes.
 */
function resolveContent(node: ProseMirrorNode, start: number, resolution: Resolution): Fragment {
  const { match, action, ranges } = resolution
  let children: ProseMirrorNode[] | undefined
  node.forEach((child, offset, index) => {
    let next: ProseMirrorNode | null = child
    if (child.isInline) {
      for (const mark of child.marks) {
        const ref = suggestionFromMark(mark)
        if (!ref || !match(ref)) continue
        if (removesContent(ref.kind, action)) {
          ranges?.push(start + offset, child.nodeSize, 0)
          next = null
        } else {
          next = child.mark(mark.removeFromSet(child.marks))
        }
        break
      }
    } else {
      next = resolveBlock(child, start + offset, resolution)
    }
    if (next === child && !children) return
    if (!children) {
      children = []
      for (let kept = 0; kept < index; kept++) children.push(node.child(kept))
    }
    if (next) children.push(next)
  })
  // Rebuilding joins text the removed markers used to split, as it was before the suggestion.
  return children ? Fragment.fromArray(children) : node.content
}

/** `node` (at `pos`) with the selected suggestions resolved, or null when that removes it. */
function resolveBlock(node: ProseMirrorNode, pos: number, resolution: Resolution): ProseMirrorNode | null {
  const { ranges } = resolution
  const block = parseBlockSuggestion(node.attrs[SUGGESTION_BLOCK_ATTR])
  const own = block && resolution.match(block) ? block : null
  if (own && removesContent(own.kind, resolution.action)) {
    ranges?.push(pos, node.nodeSize, 0)
    return null
  }
  const first = ranges?.length ?? 0
  const content = resolveContent(node, pos + 1, resolution)
  if (!own && content === node.content) return node
  const attrs = own ? { ...node.attrs, [SUGGESTION_BLOCK_ATTR]: null } : node.attrs
  if (node.type.validContent(content)) return node.type.create(attrs, content, node.marks)
  // Removing children left the node invalid. Like deleting them in an editor would: an emptied
  // container goes too, except a table cell, which keeps an empty paragraph so its row stays
  // whole; other content gets what it needs added (an item's first paragraph, …).
  const cell = node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell'
  const fixed = content.size || cell ? node.type.createAndFill(attrs, content, node.marks) : null
  if (ranges) {
    ranges.length = first
    if (fixed) ranges.push(pos + 1, node.content.size, fixed.content.size)
    else ranges.push(pos, node.nodeSize, 0)
  }
  return fixed
}

/** `doc` with the selected suggestions resolved; a document left empty gets an empty paragraph. */
function resolveDoc(doc: ProseMirrorNode, resolution: Resolution): ProseMirrorNode {
  const content = resolveContent(doc, 0, resolution)
  if (content === doc.content) return doc
  if (content.size) return doc.type.create(doc.attrs, content, doc.marks)
  const filled = doc.type.createAndFill(doc.attrs, content, doc.marks) ?? doc.type.create(doc.attrs, content, doc.marks)
  if (resolution.ranges) {
    resolution.ranges.length = 0
    resolution.ranges.push(0, doc.content.size, filled.content.size)
  }
  return filled
}

/**
 * `node` with the hunks `match` selects accepted or rejected, or null when that removes it
 * (a document is never removed: it keeps an empty paragraph).
 */
export function resolveNode(node: ProseMirrorNode, match: (ref: SuggestionRef) => boolean, action: SuggestionAction): ProseMirrorNode | null {
  return node.type === node.type.schema.topNodeType ? resolveDoc(node, { match, action }) : resolveBlock(node, 0, { match, action })
}

/**
 * Accepts or rejects the hunks `match` selects, appending steps to `tr` (an editor transaction
 * or a plain Transform on the server). Accepting an insertion or rejecting a deletion keeps the
 * content and drops the marker; the other two remove the content.
 *
 * The result is built in one pass and applied as a single step over the range that changed,
 * so resolving thousands of hunks stays cheap. An editor transaction's selection still moves
 * as if each piece had been removed on its own.
 */
export function resolveSuggestions<T extends Transform>(tr: T, match: (ref: SuggestionRef) => boolean, action: SuggestionAction): T {
  const ranges: number[] = []
  const before = tr.doc
  const after = resolveDoc(before, { match, action, ranges })
  if (after === before) return tr
  const start = before.content.findDiffStart(after.content)
  if (start === null) return tr
  let { a: endBefore, b: endAfter } = before.content.findDiffEnd(after.content)!
  // Repeated content can make the two ends cross the start; widen both by the same amount.
  const overlap = start - Math.min(endBefore, endAfter)
  if (overlap > 0) {
    endBefore += overlap
    endAfter += overlap
  }
  const selection = tr instanceof Transaction ? tr.selection : undefined
  const step = new ReplaceStep(start, endBefore, after.slice(start, endAfter))
  if (step.apply(before).doc?.eq(after)) tr.step(step)
  else tr.replaceWith(0, before.content.size, after.content)
  if (selection && tr instanceof Transaction) tr.setSelection(selection.map(tr.doc, new StepMap(ranges)))
  return tr
}

/** The document with every suggestion rejected (`base`) or accepted (`proposed`). */
export function docView(doc: ProseMirrorNode, view: DocView): ProseMirrorNode {
  return resolveDoc(doc, { match: () => true, action: view === 'base' ? 'reject' : 'accept' })
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
