import * as Y from 'yjs'
import { containsMarker } from './file.js'
import { compactJson, jsonNode, parseJson, type JsonNode } from './json.js'
import {
  ASSET_MARKER,
  cellAttachments,
  cellExecutionCount,
  cellMetadata,
  cellOutputs,
  cellsMap,
  cellSourceText,
  cellType,
  EMPTY_OUTPUTS,
  metadataValue,
  notebookMap,
  orderedCells,
  type NotebookBlob,
  type NotebookCellType,
} from './layout.js'
import { orderKeyBetween } from './order.js'

/**
 * Edits to a notebook's Y.Doc that editors and the codec share. Each runs in one transaction with
 * the given origin, so an editor's undo manager can track (and undo) exactly its own.
 */

/** What a new cell holds. Everything but its type is optional. */
export interface CellInit {
  type: NotebookCellType
  source?: string
  /** The nbformat id; notebooks of nbformat 4.5 and later give every new cell one. */
  id?: string
  sourceShape?: 'lines' | 'string'
  /** Metadata entries as compact JSON, in order. */
  metadata?: [string, string][]
  executionCount?: number | null
  outputs?: NotebookBlob
  attachments?: NotebookBlob
  keys?: string[]
  /** Keys the format doesn't model, with their compact JSON, in order (pairs, so any key name is safe). */
  extra?: [string, string][]
}

/** A random cell key: 16 hex digits, so concurrent inserts never collide. */
export function newCellKey(random?: () => number): string {
  const bytes = new Uint8Array(8)
  if (random) for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(random() * 256)
  else globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A seeded generator (mulberry32), so two runs of the same edit make the same keys. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Whether new cells get nbformat ids (nbformat 4.5 and later). */
export function notebookHasCellIds(doc: Y.Doc): boolean {
  const map = notebookMap(doc)
  const major = map.get('nbformat')
  const minor = map.get('nbformat_minor')
  return typeof major === 'number' && (major > 4 || (major === 4 && typeof minor === 'number' && minor >= 5))
}

/** A cell's Y.Map, filled before it joins the document. */
export function createCellMap(init: CellInit, order: string): Y.Map<unknown> {
  const cell = new Y.Map<unknown>()
  cell.set('order', order)
  if (init.id !== undefined) cell.set('id', init.id)
  cell.set('cell_type', init.type)
  cell.set('source', new Y.Text(init.source ?? ''))
  cell.set('sourceShape', init.sourceShape ?? 'lines')
  cell.set('metadata', new Y.Map<string>(init.metadata ?? []))
  if (init.metadata?.length) cell.set('metadataKeys', init.metadata.map(([key]) => key))
  if (init.keys) cell.set('keys', init.keys)
  if (init.type === 'code') {
    cell.set('execution_count', init.executionCount ?? null)
    cell.set('outputs', init.outputs ?? EMPTY_OUTPUTS)
  } else if (init.attachments) {
    cell.set('attachments', init.attachments)
  }
  if (init.extra?.length) cell.set('extra', init.extra)
  return cell
}

/** Where to insert: after a cell, before one, or at the start (`after: null`) or end (`before: null`). */
export type CellPosition = { after: string | null } | { before: string | null }

/** The order keys on either side of a position. */
function neighbours(doc: Y.Doc, position: CellPosition, exclude: ReadonlySet<string> = new Set()): [string | null, string | null] {
  const cells = orderedCells(doc).filter((entry) => !exclude.has(entry.key))
  if ('after' in position) {
    if (position.after === null) return [null, cells[0]?.order ?? null]
    const index = cells.findIndex((entry) => entry.key === position.after)
    if (index < 0) return [cells[cells.length - 1]?.order ?? null, null]
    return [cells[index]!.order, cells[index + 1]?.order ?? null]
  }
  if (position.before === null) return [cells[cells.length - 1]?.order ?? null, null]
  const index = cells.findIndex((entry) => entry.key === position.before)
  if (index < 0) return [cells[cells.length - 1]?.order ?? null, null]
  return [cells[index - 1]?.order ?? null, cells[index]!.order]
}

/** Inserts cells at a position, in order; returns their keys. */
export function insertCells(doc: Y.Doc, position: CellPosition, inits: readonly CellInit[], origin?: unknown): string[] {
  const keys: string[] = []
  doc.transact(() => {
    let [before, after] = neighbours(doc, position)
    const ids = notebookHasCellIds(doc)
    const map = cellsMap(doc)
    for (const init of inits) {
      const key = newCellKey()
      const order = orderKeyBetween(before, after)
      map.set(key, createCellMap(ids && init.id === undefined ? { ...init, id: key.slice(0, 8) } : init, order))
      keys.push(key)
      before = order
    }
  }, origin)
  return keys
}

export function deleteCells(doc: Y.Doc, keys: readonly string[], origin?: unknown): void {
  doc.transact(() => {
    const map = cellsMap(doc)
    for (const key of keys) map.delete(key)
  }, origin)
}

/** Moves cells (kept in their order) to a position; their content and concurrent edits to it stay. */
export function moveCells(doc: Y.Doc, keys: readonly string[], position: CellPosition, origin?: unknown): void {
  const moving = new Set(keys)
  doc.transact(() => {
    let [before, after] = neighbours(doc, position, moving)
    const ordered = orderedCells(doc).filter((entry) => moving.has(entry.key))
    for (const entry of ordered) {
      const order = orderKeyBetween(before, after)
      entry.cell.set('order', order)
      before = order
    }
  }, origin)
}

/** Moves the cells one place up or down, past the neighbouring cell. */
export function shiftCells(doc: Y.Doc, keys: readonly string[], direction: 'up' | 'down', origin?: unknown): void {
  const cells = orderedCells(doc)
  const moving = new Set(keys)
  const indexes = cells.flatMap((entry, index) => (moving.has(entry.key) ? [index] : []))
  if (!indexes.length) return
  if (direction === 'up') {
    const first = indexes[0]!
    if (first === 0) return
    moveCells(doc, keys, { before: cells[first - 1]!.key }, origin)
  } else {
    const last = indexes[indexes.length - 1]!
    if (last === cells.length - 1) return
    moveCells(doc, keys, { after: cells[last + 1]!.key }, origin)
  }
}

/** Changes cell types; code cells lose their outputs and Markdown cells their attachments, as in Jupyter. */
export function setCellType(doc: Y.Doc, keys: readonly string[], type: NotebookCellType, origin?: unknown): void {
  doc.transact(() => {
    const map = cellsMap(doc)
    for (const key of keys) {
      const cell = map.get(key)
      if (!cell || cellType(cell) === type) continue
      cell.set('cell_type', type)
      if (type === 'code') {
        cell.delete('attachments')
        cell.set('execution_count', null)
        cell.set('outputs', EMPTY_OUTPUTS)
      } else {
        cell.delete('execution_count')
        cell.delete('outputs')
      }
    }
  }, origin)
}

/** Clears outputs and execution counts of the cells (every cell when `keys` is null). */
export function clearOutputs(doc: Y.Doc, keys: readonly string[] | null, origin?: unknown): void {
  doc.transact(() => {
    const cells = keys ? keys.flatMap((key) => cellsMap(doc).get(key) ?? []) : orderedCells(doc).map((entry) => entry.cell)
    for (const cell of cells) {
      if (cellType(cell) !== 'code') continue
      const outputs = cellOutputs(cell)
      if (outputs.json !== '[]' || outputs.assets.length) cell.set('outputs', EMPTY_OUTPUTS)
      if (cellExecutionCount(cell) !== null) cell.set('execution_count', null)
    }
  }, origin)
}

function setJupyterFlag(cell: Y.Map<unknown>, flag: 'outputs_hidden' | 'source_hidden', value: boolean): void {
  let metadata = cellMetadata(cell)
  if (!metadata) {
    metadata = new Y.Map<string>()
    cell.set('metadata', metadata)
  }
  const current = metadataValue(metadata, 'jupyter')
  const jupyter = typeof current === 'object' && current !== null && !Array.isArray(current) ? { ...current as Record<string, unknown> } : {}
  if (value) jupyter[flag] = true
  else delete jupyter[flag]
  if (Object.keys(jupyter).length) metadata.set('jupyter', JSON.stringify(jupyter))
  else if (metadata.has('jupyter')) metadata.delete('jupyter')
  // Classic Notebook's flag, which JupyterLab still writes beside its own.
  if (flag === 'outputs_hidden') {
    if (value) metadata.set('collapsed', 'true')
    else if (metadata.has('collapsed')) metadata.delete('collapsed')
  }
}

/** Collapses or expands the cells' outputs, as JupyterLab records it. */
export function setOutputsCollapsed(doc: Y.Doc, keys: readonly string[], collapsed: boolean, origin?: unknown): void {
  doc.transact(() => {
    for (const key of keys) {
      const cell = cellsMap(doc).get(key)
      if (cell) setJupyterFlag(cell, 'outputs_hidden', collapsed)
    }
  }, origin)
}

export function setSourceCollapsed(doc: Y.Doc, keys: readonly string[], collapsed: boolean, origin?: unknown): void {
  doc.transact(() => {
    for (const key of keys) {
      const cell = cellsMap(doc).get(key)
      if (cell) setJupyterFlag(cell, 'source_hidden', collapsed)
    }
  }, origin)
}

/**
 * Splits a cell at character offsets: the cell keeps the text before the first, and each piece
 * after becomes a new cell of the same type below it. Returns the keys of every piece.
 */
export function splitCell(doc: Y.Doc, key: string, offsets: readonly number[], origin?: unknown): string[] {
  const cell = cellsMap(doc).get(key)
  if (!cell) return []
  const text = cellSourceText(cell)
  const cuts = [...new Set(offsets.map((offset) => Math.max(0, Math.min(text.length, offset))))].sort((a, b) => a - b)
  if (!cuts.length) return [key]
  // A line break at a cut belongs to neither piece, as in JupyterLab.
  const segments = [0, ...cuts].map((start, index) => text.slice(start, cuts[index] ?? text.length))
  const pieces = segments.map((segment, index) => {
    let piece = segment
    if (index > 0) piece = piece.replace(/^\n/, '')
    if (index < segments.length - 1) piece = piece.replace(/\n$/, '')
    return piece
  })
  let keys: string[] = [key]
  doc.transact(() => {
    const source = cell.get('source')
    if (source instanceof Y.Text && source.length > pieces[0]!.length) source.delete(pieces[0]!.length, source.length - pieces[0]!.length)
    const type = cellType(cell)
    keys = [key, ...insertCells(doc, { after: key }, pieces.slice(1).map((piece) => ({ type, source: piece, attachments: type === 'code' ? undefined : cellAttachments(cell) ?? undefined })), origin)]
  }, origin)
  return keys
}

function offsetAssetMarkers(node: JsonNode, offset: number): JsonNode {
  if (node.kind === 'string' && node.value.startsWith(ASSET_MARKER)) return jsonNode(`${ASSET_MARKER}${Number(node.value.slice(ASSET_MARKER.length)) + offset}`)
  if (node.kind === 'array') return { ...node, items: node.items.map((item) => offsetAssetMarkers(item, offset)) }
  if (node.kind === 'object') return { ...node, entries: node.entries.map((entry) => ({ ...entry, value: offsetAssetMarkers(entry.value, offset) })) }
  return node
}

/** How a cell's attachments hold placeholder-like text: as slots, literally, or not at all. */
function attachmentMode(cell: Y.Map<unknown>): 'slots' | 'literal' | null {
  const blob = cellType(cell) === 'code' ? null : cellAttachments(cell)
  if (!blob) return null
  if (blob.assets.length) return 'slots'
  return containsMarker(parseJson(blob.json)) ? 'literal' : null
}

/**
 * The attachments of merged cells as one blob: names from the first cell that has them win, and
 * later cells' placeholders are renumbered after the earlier cells' slots. (Cells whose blobs hold
 * placeholder-like text literally are never merged with cells that have slots; see `mergeCells`.)
 */
function mergedAttachments(cells: Y.Map<unknown>[]): NotebookBlob | null {
  const merged: Extract<JsonNode, { kind: 'object' }> = { kind: 'object', entries: [] }
  const assets: NotebookBlob['assets'] = []
  const names = new Set<string>()
  let present = false
  for (const cell of cells) {
    const blob = cellType(cell) === 'code' ? null : cellAttachments(cell)
    if (!blob) continue
    present = true
    const node = parseJson(blob.json)
    if (node.kind !== 'object') continue
    const offset = assets.length
    for (const slot of blob.assets) assets.push(slot)
    for (const entry of node.entries) {
      if (names.has(entry.key)) continue
      names.add(entry.key)
      merged.entries.push({ ...entry, value: blob.assets.length ? offsetAssetMarkers(entry.value, offset) : entry.value })
    }
  }
  return present ? { json: compactJson(merged), assets } : null
}

/** Joins cells into the first of them (in notebook order); the others are deleted. */
export function mergeCells(doc: Y.Doc, keys: readonly string[], origin?: unknown): string | null {
  const wanted = new Set(keys)
  const cells = orderedCells(doc).filter((entry) => wanted.has(entry.key))
  if (cells.length < 2) return cells[0]?.key ?? null
  const [first, ...rest] = cells
  // Literal placeholder-like text would read as a placeholder beside real slots; such rare cells
  // stay apart rather than lose an attachment.
  const modes = new Set(cells.map((entry) => attachmentMode(entry.cell)))
  if (modes.has('slots') && modes.has('literal')) return null
  doc.transact(() => {
    const source = first!.cell.get('source')
    const addition = rest.map((entry) => cellSourceText(entry.cell)).join('\n\n')
    if (source instanceof Y.Text) source.insert(source.length, `${source.length ? '\n\n' : ''}${addition}`)
    else first!.cell.set('source', new Y.Text(addition))
    if (cellType(first!.cell) === 'code') {
      first!.cell.set('outputs', EMPTY_OUTPUTS)
      first!.cell.set('execution_count', null)
    } else {
      const attachments = mergedAttachments(cells.map((entry) => entry.cell))
      if (attachments) first!.cell.set('attachments', attachments)
    }
    for (const entry of rest) cellsMap(doc).delete(entry.key)
  }, origin)
  return first!.key
}

/** A cell as the clipboard keeps it: what a copy needs, outputs included, but not its id (a copy gets its own). */
export function cellInitOf(cell: Y.Map<unknown>): CellInit {
  const metadata = cellMetadata(cell)
  const type = cellType(cell)
  return {
    type,
    source: cellSourceText(cell),
    sourceShape: cell.get('sourceShape') === 'string' ? 'string' : 'lines',
    metadata: metadata ? [...metadata.entries()].filter(([, value]) => typeof value === 'string') : [],
    ...type === 'code' ? { executionCount: cellExecutionCount(cell), outputs: cellOutputs(cell) } : {},
    ...cellAttachments(cell) ? { attachments: cellAttachments(cell)! } : {},
  }
}
