import { Fragment, Node as ProseMirrorNode, type Mark } from '@tiptap/pm/model'
import { docJSONToMarkdown, markdownToDocJSON } from './schema.js'
import {
  docView,
  formatBlockSuggestion,
  parseBlockSuggestion,
  resolveNode,
  suggestionFromMark,
  SUGGESTION_BLOCK_ATTR,
  SUGGESTION_DELETE_MARK,
  SUGGESTION_INSERT_MARK,
  type MergeMarkdownResult,
  type SuggestionKind,
} from './suggestions.js'

/*
 * How a merge works: at each level of the tree, the old blocks (minus those a suggestion
 * already deletes) are diffed against the new ones, two blocks matching when their proposed
 * views read the same in Markdown. Matched blocks stay untouched. Between matches, blocks of
 * the same kind that are alike enough pair up and get merged recursively, down to a word diff
 * inside paragraphs, headings, and code blocks; the rest become whole-block insertions and
 * deletions.
 */

type Mode = 'suggest' | 'write'
/** Wraps a child in its ancestors up to the document, so the serializer sees it in context. */
type Wrap = (node: ProseMirrorNode) => ProseMirrorNode

/**
 * Sequences further apart than this many insertions plus deletions are not diffed: everything
 * between their common prefix and suffix counts as changed. Bounds time and memory (D²).
 */
const MAX_EDIT_DISTANCE = 2000
/** Gaps of unmatched blocks with more candidate pairs than this get paired greedily. */
const MAX_PAIRING_CELLS = 40_000
const PAIRING_LOOKAHEAD = 8
const PAIRING_SKIP_COST = 0.05
/** How alike (Dice coefficient over words) two blocks must be to diff one into the other. */
const MIN_SIMILARITY = 0.3

/** Words, whitespace runs, single CJK characters, and single other characters. */
const TOKEN = /\s+|[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]|(?:(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}])[\p{L}\p{M}\p{N}])+|[^]/gu
const WORD = /^[\p{L}\p{M}\p{N}]/u

function randomId(): string {
  let id = ''
  for (const byte of crypto.getRandomValues(new Uint8Array(12))) id += (byte % 36).toString(36)
  return id
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
  current: ProseMirrorNode,
  markdown: string,
  options: { mode: 'suggest' | 'write'; changeId: string; newId?: () => string },
): MergeMarkdownResult {
  const json = markdownToDocJSON(markdown)
  // Serializing is lossy in places (adjacent lists, blank lines), so pushing back exactly what
  // was pulled cannot be told apart block by block; compare whole documents first.
  const proposed = docJSONToMarkdown(docView(current, 'proposed').toJSON())
  if (markdown === proposed || docJSONToMarkdown(json) === proposed) return { doc: current, changed: false, hunks: 0 }
  const target = ProseMirrorNode.fromJSON(current.type.schema, json)
  const merge = new Merge(current, options.mode, options.changeId, options.newId ?? randomId)
  const children = merge.children(current, target, (child) => current.type.create(current.attrs, child), options.mode)
  const doc = current.type.create(current.attrs, Fragment.fromArray(children), current.marks)
  return { doc, changed: !doc.eq(current), hunks: merge.hunks }
}

function blockSuggestion(node: ProseMirrorNode): SuggestionKind | undefined {
  return parseBlockSuggestion(node.attrs[SUGGESTION_BLOCK_ATTR])?.kind
}

function isSuggestionMark(mark: Mark): boolean {
  return mark.type.name === SUGGESTION_INSERT_MARK || mark.type.name === SUGGESTION_DELETE_MARK
}

function inlineSuggestion(node: ProseMirrorNode): SuggestionKind | undefined {
  for (const mark of node.marks) if (isSuggestionMark(mark)) return suggestionFromMark(mark)?.kind
  return undefined
}

/** `node` with every suggestion accepted, or null when that removes it. */
function proposedNode(node: ProseMirrorNode): ProseMirrorNode | null {
  return resolveNode(node, () => true, 'accept')
}

/** A block's Markdown in context: whether two blocks read the same decides if they match. */
function serialize(node: ProseMirrorNode | null, wrap: Wrap): string {
  return node ? docJSONToMarkdown(wrap(node).toJSON()) : '\u0000removed'
}

/**
 * Blocks with the same pair key are the same kind of block (heading level, list start and
 * numbering, code language, task state, …), so one can be diffed into the other.
 */
function pairKey(node: ProseMirrorNode): string {
  const { [SUGGESTION_BLOCK_ATTR]: _, ...attrs } = node.attrs
  switch (node.type.name) {
    // Rows only pair with rows of the same shape, so tables stay rectangular however their
    // hunks get resolved (a column change replaces the table).
    case 'table': return `table:${node.firstChild?.childCount ?? 0}`
    case 'tableRow': {
      const cells: string[] = []
      node.forEach((cell) => cells.push(`${cell.type.name}:${cell.attrs.align ?? ''}`))
      return `tableRow:${cells.join(',')}`
    }
    default: return `${node.type.name}:${JSON.stringify(attrs)}`
  }
}

function words(node: ProseMirrorNode | null): Map<string, number> {
  const bag = new Map<string, number>()
  const text = node?.textBetween(0, node.content.size, ' ', ' ') ?? ''
  for (const [token] of text.matchAll(TOKEN)) {
    if (!WORD.test(token)) continue
    const word = token.toLowerCase()
    bag.set(word, (bag.get(word) ?? 0) + 1)
  }
  return bag
}

function similarity(a: Map<string, number>, b: Map<string, number>): number {
  let total = 0
  let shared = 0
  for (const count of a.values()) total += count
  for (const [word, count] of b) {
    total += count
    shared += Math.min(count, a.get(word) ?? 0)
  }
  return total ? (2 * shared) / total : 1
}

/**
 * Myers' O((N+M)D) diff: index pairs of a longest common subsequence, or null when the
 * sequences are more than `MAX_EDIT_DISTANCE` insertions and deletions apart.
 */
function myersDiff(n: number, m: number, equal: (i: number, j: number) => boolean): Array<[number, number]> | null {
  const max = Math.min(n + m, MAX_EDIT_DISTANCE)
  const offset = max + 1
  // Furthest x reached on each diagonal k = x - y, indexed by k + offset.
  const reach = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(reach.slice(offset - d, offset + d + 1))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && reach[offset + k - 1]! < reach[offset + k + 1]!) ? reach[offset + k + 1]! : reach[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && equal(x, y)) {
        x++
        y++
      }
      reach[offset + k] = x
      if (x < n || y < m) continue
      const pairs: Array<[number, number]> = []
      for (let step = d; step > 0; step--) {
        const before = trace[step]!
        const at = (diagonal: number) => before[diagonal + step]!
        const diagonal = x - y
        const previous = diagonal === -step || (diagonal !== step && at(diagonal - 1) < at(diagonal + 1)) ? diagonal + 1 : diagonal - 1
        const previousX = at(previous)
        const previousY = previousX - previous
        while (x > previousX && y > previousY) pairs.push([--x, --y])
        x = previousX
        y = previousY
      }
      while (x > 0 && y > 0) pairs.push([--x, --y])
      return pairs.reverse()
    }
  }
  return null
}

/**
 * Index pairs of a longest common subsequence of two sequences. Only the common prefix and
 * suffix match when the rest is too far apart (see `MAX_EDIT_DISTANCE`).
 */
function commonSubsequence(oldLength: number, newLength: number, equal: (i: number, j: number) => boolean): Array<[number, number]> {
  let start = 0
  while (start < oldLength && start < newLength && equal(start, start)) start++
  let end = 0
  while (end < oldLength - start && end < newLength - start && equal(oldLength - 1 - end, newLength - 1 - end)) end++
  const pairs: Array<[number, number]> = []
  for (let k = 0; k < start; k++) pairs.push([k, k])
  const middle = myersDiff(oldLength - start - end, newLength - start - end, (i, j) => equal(start + i, start + j))
  for (const [i, j] of middle ?? []) pairs.push([start + i, start + j])
  for (let k = end; k > 0; k--) pairs.push([oldLength - k, newLength - k])
  return pairs
}

type Op =
  | { kind: 'same'; old: number; new: number }
  | { kind: 'pair'; old: number; new: number }
  | { kind: 'delete'; old: number }
  | { kind: 'insert'; new: number }

/** Turns matched index pairs into an edit script, deletions before insertions in each gap. */
function editScript(pairs: Array<[number, number]>, oldLength: number, newLength: number, gap: (oldFrom: number, oldTo: number, newFrom: number, newTo: number) => Op[]): Op[] {
  const ops: Op[] = []
  let i = 0
  let j = 0
  for (const [oldIndex, newIndex] of [...pairs, [oldLength, newLength] satisfies [number, number]]) {
    ops.push(...gap(i, oldIndex, j, newIndex))
    if (oldIndex < oldLength) ops.push({ kind: 'same', old: oldIndex, new: newIndex })
    i = oldIndex + 1
    j = newIndex + 1
  }
  return ops
}

function replaceAll(oldFrom: number, oldTo: number, newFrom: number, newTo: number): Op[] {
  return [
    ...Array.from({ length: oldTo - oldFrom }, (_, k): Op => ({ kind: 'delete', old: oldFrom + k })),
    ...Array.from({ length: newTo - newFrom }, (_, k): Op => ({ kind: 'insert', new: newFrom + k })),
  ]
}

/**
 * Pairs up the unmatched blocks between two matches so they get diffed instead of replaced:
 * in order, by `alike` (similarity, or -1 for blocks of different kinds). A lone pair always
 * pairs; short gaps take the pairing with the highest total similarity, long ones a greedy pass
 * that looks a few blocks ahead.
 */
function pairBlocks(oldFrom: number, oldTo: number, newFrom: number, newTo: number, alike: (i: number, j: number) => number): Op[] {
  const a = oldTo - oldFrom
  const b = newTo - newFrom
  if (a === 1 && b === 1 && alike(oldFrom, newFrom) >= 0) return [{ kind: 'pair', old: oldFrom, new: newFrom }]
  if (a === 0 || b === 0) return replaceAll(oldFrom, oldTo, newFrom, newTo)
  const ops: Op[] = []
  if (a * b > MAX_PAIRING_CELLS) {
    let i = oldFrom
    let j = newFrom
    while (i < oldTo && j < newTo) {
      // Pair the next block on one side with the most alike of the next few on the other,
      // preferring nearer ones; the blocks skipped over are deleted or inserted.
      let best: { score: number; skip: number; side: 'old' | 'new' } | undefined
      for (let skip = 0; skip <= PAIRING_LOOKAHEAD; skip++) {
        for (const side of ['new', 'old'] as const) {
          const [oldIndex, newIndex] = side === 'new' ? [i, j + skip] : [i + skip, j]
          if (oldIndex >= oldTo || newIndex >= newTo) continue
          const closeness = alike(oldIndex, newIndex)
          const score = closeness - skip * PAIRING_SKIP_COST
          if (closeness >= MIN_SIMILARITY && (!best || score > best.score)) best = { score, skip, side }
        }
      }
      if (!best) {
        ops.push({ kind: 'delete', old: i++ }, { kind: 'insert', new: j++ })
        continue
      }
      for (let k = 0; k < best.skip; k++) ops.push(best.side === 'new' ? { kind: 'insert', new: j++ } : { kind: 'delete', old: i++ })
      ops.push({ kind: 'pair', old: i++, new: j++ })
    }
    return [...ops, ...replaceAll(i, oldTo, j, newTo)]
  }
  const width = b + 1
  const score = new Float64Array((a + 1) * width)
  const choice = new Uint8Array((a + 1) * width)
  for (let i = a - 1; i >= 0; i--) {
    for (let j = b - 1; j >= 0; j--) {
      const skipOld = score[(i + 1) * width + j]!
      const skipNew = score[i * width + j + 1]!
      const closeness = alike(oldFrom + i, newFrom + j)
      const paired = closeness >= MIN_SIMILARITY ? closeness + score[(i + 1) * width + j + 1]! : -1
      const best = Math.max(skipOld, skipNew, paired)
      score[i * width + j] = best
      choice[i * width + j] = best === paired ? 2 : best === skipOld ? 0 : 1
    }
  }
  let i = 0
  let j = 0
  while (i < a || j < b) {
    const step = i === a ? 1 : j === b ? 0 : choice[i * width + j]!
    if (step === 2) ops.push({ kind: 'pair', old: oldFrom + i++, new: newFrom + j++ })
    else if (step === 0) ops.push({ kind: 'delete', old: oldFrom + i++ })
    else ops.push({ kind: 'insert', new: newFrom + j++ })
  }
  return ops
}

interface Piece {
  node: ProseMirrorNode
  /** Carries `suggestionDelete`: not in the proposed view, so it neither matches nor moves. */
  hidden: boolean
}

interface Token {
  key: string
  space: boolean
  /** Slices of pieces, as offsets into each piece (inline nodes are 0 to 1). */
  parts: Array<{ piece: number; from: number; to: number }>
}

function markKey(marks: readonly Mark[]): string {
  return marks.filter((mark) => !isSuggestionMark(mark))
    .map((mark) => mark.type.name === 'link' ? `link:${mark.attrs.href}|${mark.attrs.title ?? ''}` : `${mark.type.name}:${JSON.stringify(mark.attrs)}`)
    .join(',')
}

function pieceSize(node: ProseMirrorNode): number {
  return node.isText ? node.text!.length : 1
}

/** Splits a textblock's visible content into tokens that each keep one set of marks. */
function tokenize(block: ProseMirrorNode): { pieces: Piece[]; tokens: Token[] } {
  const pieces: Piece[] = []
  block.forEach((node) => pieces.push({ node, hidden: inlineSuggestion(node) === 'delete' }))
  const tokens: Token[] = []
  let run: { key: string; text: string; segments: Array<{ piece: number; start: number }> } | null = null
  const flush = () => {
    if (!run) return
    const { key, text, segments } = run
    run = null
    let segment = 0
    for (const match of text.matchAll(TOKEN)) {
      const start = match.index
      const end = start + match[0].length
      const parts: Token['parts'] = []
      while (segment < segments.length - 1 && segments[segment + 1]!.start <= start) segment++
      for (let s = segment; s < segments.length && segments[s]!.start < end; s++) {
        const { piece, start: offset } = segments[s]!
        const size = pieceSize(pieces[piece]!.node)
        parts.push({ piece, from: Math.max(start, offset) - offset, to: Math.min(end, offset + size) - offset })
      }
      tokens.push({ key: `${key}\u0000${match[0]}`, space: !match[0].trim(), parts })
    }
  }
  pieces.forEach(({ node, hidden }, piece) => {
    if (hidden) return
    if (node.isText) {
      const key = markKey(node.marks)
      if (run?.key !== key) {
        flush()
        run = { key, text: '', segments: [] }
      }
      run!.segments.push({ piece, start: run!.text.length })
      run!.text += node.text
    } else {
      flush()
      tokens.push({ key: `\u0001${node.type.name}:${JSON.stringify(node.attrs)}:${markKey(node.marks)}`, space: false, parts: [{ piece, from: 0, to: 1 }] })
    }
  })
  flush()
  return { pieces, tokens }
}

/** One hunk being written; its id is only allocated once something gets marked with it. */
class Hunk {
  private id: string | undefined
  private changed = false
  constructor(private readonly merge: Merge, private readonly mode: Mode) {}

  /** `node` (inline, or a whole block) as this hunk inserts it. */
  insert(node: ProseMirrorNode): ProseMirrorNode {
    this.changed = true
    return this.mode === 'write' ? node : this.suggest(node, 'insert')
  }

  /** `node` as this hunk deletes it, or null when it goes away right now. */
  delete(node: ProseMirrorNode): ProseMirrorNode | null {
    this.changed = true
    // Content an earlier suggestion inserted was never accepted, so it simply goes.
    const pending = node.isInline ? inlineSuggestion(node) : blockSuggestion(node)
    return this.mode === 'write' || pending === 'insert' ? null : this.suggest(node, 'delete')
  }

  close() {
    if (this.merge.mode === 'suggest' ? this.id : this.changed) this.merge.hunks++
  }

  private suggest(node: ProseMirrorNode, kind: SuggestionKind): ProseMirrorNode {
    this.id ??= this.merge.newId()
    const { changeId } = this.merge
    if (!node.isInline) {
      const value = formatBlockSuggestion({ kind, changeId, id: this.id })
      return node.type.create({ ...node.attrs, [SUGGESTION_BLOCK_ATTR]: value }, node.content, node.marks)
    }
    const type = node.type.schema.marks[kind === 'insert' ? SUGGESTION_INSERT_MARK : SUGGESTION_DELETE_MARK]!
    return node.mark(type.create({ id: this.id, changeId }).addToSet(node.marks))
  }
}

class Merge {
  hunks = 0
  private readonly ids = new Set<string>()

  constructor(current: ProseMirrorNode, readonly mode: Mode, readonly changeId: string, private readonly generateId: () => string) {
    current.descendants((node) => {
      const block = parseBlockSuggestion(node.attrs[SUGGESTION_BLOCK_ATTR])
      if (block) this.ids.add(block.id)
      for (const mark of node.marks) {
        const ref = suggestionFromMark(mark)
        if (ref) this.ids.add(ref.id)
      }
    })
  }

  newId(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = this.generateId()
      if (!this.ids.has(id)) {
        this.ids.add(id)
        return id
      }
    }
    throw new Error('Could not generate a unique suggestion id')
  }

  /** The merged children of `old`, so that their proposed view matches those of `fresh`. */
  children(old: ProseMirrorNode, fresh: ProseMirrorNode, wrap: Wrap, mode: Mode): ProseMirrorNode[] {
    // Blocks an earlier suggestion deletes are invisible to the diff and stay right after the
    // visible block they followed.
    const visible: ProseMirrorNode[] = []
    const hiddenAfter: ProseMirrorNode[][] = [[]]
    old.forEach((child) => {
      if (blockSuggestion(child) === 'delete') hiddenAfter.at(-1)!.push(child)
      else {
        visible.push(child)
        hiddenAfter.push([])
      }
    })
    const next: ProseMirrorNode[] = []
    fresh.forEach((child) => next.push(child))

    const oldViews = new Map<number, ProseMirrorNode | null>()
    const oldView = (i: number) => oldViews.has(i) ? oldViews.get(i)! : oldViews.set(i, proposedNode(visible[i]!)).get(i)!
    const oldKeys = new Map<number, string>()
    const newKeys = new Map<number, string>()
    const oldKey = (i: number) => oldKeys.get(i) ?? oldKeys.set(i, serialize(oldView(i), wrap)).get(i)!
    const newKey = (j: number) => newKeys.get(j) ?? newKeys.set(j, serialize(next[j]!, wrap)).get(j)!
    const equal = (i: number, j: number) => visible[i]!.eq(next[j]!) || oldKey(i) === newKey(j)

    const oldWords = new Map<number, Map<string, number>>()
    const newWords = new Map<number, Map<string, number>>()
    const oldBag = (i: number) => oldWords.get(i) ?? oldWords.set(i, words(oldView(i))).get(i)!
    const newBag = (j: number) => newWords.get(j) ?? newWords.set(j, words(next[j]!)).get(j)!

    const alike = (i: number, j: number) => oldView(i) !== null && pairKey(visible[i]!) === pairKey(next[j]!) ? similarity(oldBag(i), newBag(j)) : -1
    const pairs = commonSubsequence(visible.length, next.length, equal)
    const ops = editScript(pairs, visible.length, next.length, (oldFrom, oldTo, newFrom, newTo) => pairBlocks(oldFrom, oldTo, newFrom, newTo, alike))

    const out: ProseMirrorNode[] = [...hiddenAfter[0]!]
    const keep = (i: number, node: ProseMirrorNode | null) => {
      if (node) out.push(node)
      out.push(...hiddenAfter[i + 1]!)
    }
    let deletes: number[] = []
    let inserts: number[] = []
    const flush = () => {
      if (!deletes.length && !inserts.length) return
      const hunk = new Hunk(this, mode)
      for (const i of deletes) {
        const node = visible[i]!
        // Markdown round trips lose blank paragraphs; deleting them would only be noise.
        const blank = node.type.name === 'paragraph' && !oldView(i)?.textContent.trim() && blockSuggestion(node) !== 'insert'
        keep(i, blank ? node : hunk.delete(node))
      }
      for (const j of inserts) out.push(hunk.insert(next[j]!))
      hunk.close()
      deletes = []
      inserts = []
    }
    for (const op of ops) {
      if (op.kind === 'delete') deletes.push(op.old)
      else if (op.kind === 'insert') inserts.push(op.new)
      else {
        flush()
        keep(op.old, op.kind === 'same' ? visible[op.old]! : this.node(visible[op.old]!, next[op.new]!, wrap, mode))
      }
    }
    flush()
    return out
  }

  /** Merges two paired blocks of the same kind. */
  private node(old: ProseMirrorNode, fresh: ProseMirrorNode, wrap: Wrap, mode: Mode): ProseMirrorNode {
    // A block that is itself a pending insertion is edited in place: its whole content is
    // already a suggestion.
    const inner: Mode = blockSuggestion(old) === 'insert' ? 'write' : mode
    if (old.isTextblock) return old.type.create(old.attrs, this.inline(old, fresh, inner), old.marks)
    const childWrap: Wrap = (child) => wrap(old.type.create(old.attrs, child))
    if (old.type.name === 'tableRow' && old.childCount === fresh.childCount) {
      // Cells pair up by column: a Markdown table cannot insert or delete a single cell.
      const cells: ProseMirrorNode[] = []
      old.forEach((cell, _, index) => {
        const next = fresh.child(index)
        const same = cell.eq(next) || serialize(proposedNode(cell), childWrap) === serialize(next, childWrap)
        cells.push(same ? cell : this.node(cell, next, childWrap, inner))
      })
      return old.type.create(old.attrs, cells, old.marks)
    }
    return old.type.create(old.attrs, Fragment.fromArray(this.children(old, fresh, childWrap, inner)), old.marks)
  }

  /** Word-level diff of two textblocks' inline content. */
  private inline(old: ProseMirrorNode, fresh: ProseMirrorNode, mode: Mode): Fragment {
    const before = tokenize(old)
    const after = tokenize(fresh)
    const pairs = commonSubsequence(before.tokens.length, after.tokens.length, (i, j) => before.tokens[i]!.key === after.tokens[j]!.key)
    const ops = editScript(pairs, before.tokens.length, after.tokens.length, (oldFrom, oldTo, newFrom, newTo) => [
      ...Array.from({ length: oldTo - oldFrom }, (_, k): Op => ({ kind: 'delete', old: oldFrom + k })),
      ...Array.from({ length: newTo - newFrom }, (_, k): Op => ({ kind: 'insert', new: newFrom + k })),
    ])
    // A lone space between two changes joins them into one hunk ("the quick" → "a slow").
    for (let k = 1; k < ops.length - 1; k++) {
      const op = ops[k]!
      if (op.kind === 'same' && ops[k - 1]!.kind !== 'same' && ops[k + 1]!.kind !== 'same' && before.tokens[op.old]!.space) {
        ops.splice(k, 1, { kind: 'delete', old: op.old }, { kind: 'insert', new: op.new })
      }
    }

    const out: ProseMirrorNode[] = []
    let cursor = 0
    const flushHidden = () => {
      while (cursor < before.pieces.length && before.pieces[cursor]!.hidden) out.push(before.pieces[cursor++]!.node)
    }
    const emit = (token: Token, pieces: Piece[], change: (node: ProseMirrorNode) => ProseMirrorNode | null, old: boolean) => {
      for (const { piece, from, to } of token.parts) {
        const { node } = pieces[piece]!
        const slice = node.isText ? node.cut(from, to) : node
        const changed = change(slice)
        if (changed) out.push(changed)
        if (old && to === pieceSize(node)) {
          cursor = piece + 1
          flushHidden()
        }
      }
    }
    flushHidden()
    let deletes: number[] = []
    let inserts: number[] = []
    const flush = () => {
      if (!deletes.length && !inserts.length) return
      const hunk = new Hunk(this, mode)
      for (const i of deletes) emit(before.tokens[i]!, before.pieces, (node) => hunk.delete(node), true)
      for (const j of inserts) emit(after.tokens[j]!, after.pieces, (node) => hunk.insert(node), false)
      hunk.close()
      deletes = []
      inserts = []
    }
    for (const op of ops) {
      if (op.kind === 'delete') deletes.push(op.old)
      else if (op.kind === 'insert') inserts.push(op.new)
      else {
        flush()
        emit(before.tokens[op.old]!, before.pieces, (node) => node, true)
      }
    }
    flush()
    return Fragment.fromArray(out)
  }
}
