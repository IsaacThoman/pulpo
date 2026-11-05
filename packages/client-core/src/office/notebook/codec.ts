import * as Y from 'yjs'
import { liveAssetHash, transactChanges } from '../assets.js'
import { LiveFormatError, type LiveAssetStore, type LiveFormatCodec, type LiveFormatContext } from '../live-format.js'
import { applyTextToYText } from '../text/codec.js'
import { createCellMap, newCellKey, seededRandom, type CellInit } from './edit.js'
import {
  blobNode,
  CELL_ID_PATTERN,
  makeBlob,
  restoreBudget,
  type RestoreBudget,
  readNotebookFile,
  textNode,
  type ParsedCell,
  type ParsedNotebook,
} from './file.js'
import { compactJson, JUPYTER_STYLE, parseJson, quote, writeDocument, type JsonEntry, type JsonNode, type JsonStyle } from './json.js'
import {
  ASSET_MARKER,
  cellAttachments,
  cellExecutionCount,
  cellMetadata,
  cellOutputs,
  cellsMap,
  cellSourceText,
  cellType,
  isNotebookBlob,
  NOTEBOOK_EXTENSIONS,
  NOTEBOOK_MIME_TYPE,
  NOTEBOOK_SCHEMA_VERSION,
  notebookKernelName,
  notebookMap,
  notebookMetadata,
  orderedCells,
  type NotebookBlob,
} from './layout.js'
import { longestIncreasing, matchCells } from './match.js'
import { initialOrderKeys, orderKeyBetween } from './order.js'

/** What the codec keeps to write the file back: under `notebook`, beside the version numbers. */
interface FileFacts {
  style: JsonStyle
  keys: string[]
  metadataKeys: string[]
  extra: [string, string][]
  /** The file's bytes (an asset) while the document still exports to `exportHash`. */
  original?: { asset: string; exportHash: string }
}

const STYLE_KEYS: (keyof JsonStyle)[] = ['indent', 'newline', 'colon', 'comma', 'ensureAscii', 'sortKeys', 'trailer', 'bom']

function readStyle(value: unknown): JsonStyle {
  if (typeof value !== 'object' || value === null) return JUPYTER_STYLE
  const style = value as Partial<JsonStyle>
  const text = (candidate: unknown, fallback: string, pattern: RegExp) => (typeof candidate === 'string' && pattern.test(candidate) ? candidate : fallback)
  return {
    indent: style.indent === null ? null : text(style.indent, ' ', /^[ \t]{0,16}$/),
    newline: style.newline === '\r\n' ? '\r\n' : '\n',
    colon: text(style.colon, ': ', /^[ \t]*:[ \t]*$/),
    comma: text(style.comma, ',', /^[ \t]*,[ \t]*$/),
    ensureAscii: style.ensureAscii === true,
    sortKeys: style.sortKeys !== false,
    trailer: text(style.trailer, '\n', /^[\s]{0,8}$/),
    bom: style.bom === true,
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * Unknown keys as stored: pairs of key and compact JSON. Pairs rather than an object, because
 * plain objects in a Y.Map lose `__proto__` keys on other replicas and Yjs refuses `constructor`.
 */
function stringPairs(value: unknown): [string, string][] {
  if (!Array.isArray(value)) return []
  return value.filter((pair): pair is [string, string] => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string')
}

function readFacts(doc: Y.Doc): FileFacts {
  const map = notebookMap(doc)
  const original = map.get('original') as { asset?: unknown; exportHash?: unknown } | undefined
  return {
    style: readStyle(map.get('style')),
    keys: stringList(map.get('keys')),
    metadataKeys: stringList(map.get('metadataKeys')),
    extra: stringPairs(map.get('extra')),
    ...typeof original?.asset === 'string' && typeof original.exportHash === 'string'
      ? { original: { asset: original.asset, exportHash: original.exportHash } }
      : {},
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Sets a value only when it differs, so applying an unchanged file changes nothing. */
function setIfChanged(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (value === undefined) {
    if (map.has(key)) map.delete(key)
    return
  }
  if (!map.has(key) || !sameJson(map.get(key), value)) map.set(key, value)
}

function entryPairs(entries: JsonEntry[]): [string, string][] {
  return entries.map((item) => [item.key, compactJson(item.value)])
}

/** Makes a Y.Map of compact JSON values match `entries`, key by key. */
function syncJsonMap(map: Y.Map<string>, entries: JsonEntry[]): void {
  const next = new Map(entries.map((item) => [item.key, compactJson(item.value)]))
  for (const key of [...map.keys()]) if (!next.has(key)) map.delete(key)
  for (const [key, value] of next) if (map.get(key) !== value) map.set(key, value)
}

/** A parsed cell with its outputs and attachments already moved into blobs (assets stored). */
interface PreparedCell {
  parsed: ParsedCell
  outputs: NotebookBlob | undefined
  attachments: NotebookBlob | undefined
}

async function prepareCells(parsed: ParsedNotebook, assets: LiveAssetStore): Promise<PreparedCell[]> {
  return Promise.all(parsed.cells.map(async (cell) => ({
    parsed: cell,
    outputs: cell.type === 'code' ? await makeBlob(cell.outputs ?? { kind: 'array', items: [] }, assets) : undefined,
    attachments: cell.attachments ? await makeBlob(cell.attachments, assets, true) : undefined,
  })))
}

function cellInit(prepared: PreparedCell): CellInit {
  const { parsed } = prepared
  return {
    type: parsed.type,
    source: parsed.source,
    ...parsed.id !== undefined ? { id: parsed.id } : {},
    sourceShape: parsed.sourceShape,
    metadata: parsed.metadata.map((item) => [item.key, compactJson(item.value)]),
    ...parsed.type === 'code' ? { executionCount: parsed.executionCount ?? null, outputs: prepared.outputs } : {},
    ...prepared.attachments ? { attachments: prepared.attachments } : {},
    keys: parsed.keys,
    extra: entryPairs(parsed.extra),
  }
}

/** Ids are unique in a valid notebook; repeated ones (from copy and paste in other tools) get a suffix. */
function uniqueIds(cells: PreparedCell[]): PreparedCell[] {
  const seen = new Set<string>()
  return cells.map((cell) => {
    const id = cell.parsed.id
    if (id === undefined) return cell
    let unique = id
    for (let suffix = 2; seen.has(unique); suffix += 1) unique = `${id.slice(0, 60)}-${suffix}`
    seen.add(unique)
    return unique === id ? cell : { ...cell, parsed: { ...cell.parsed, id: unique } }
  })
}

function writeNotebookFacts(doc: Y.Doc, parsed: ParsedNotebook): void {
  const map = notebookMap(doc)
  setIfChanged(map, 'nbformat', parsed.nbformat)
  setIfChanged(map, 'nbformat_minor', parsed.nbformatMinor)
  setIfChanged(map, 'style', Object.fromEntries(STYLE_KEYS.map((key) => [key, parsed.style[key]])))
  setIfChanged(map, 'keys', parsed.keys)
  setIfChanged(map, 'metadataKeys', parsed.metadata.map((item) => item.key))
  setIfChanged(map, 'extra', parsed.extra.length ? entryPairs(parsed.extra) : undefined)
  syncJsonMap(notebookMetadata(doc), parsed.metadata)
}

// Writing the file.

function entryNode(key: string, value: JsonNode, style: JsonStyle): JsonEntry {
  return { raw: quote(key, style.ensureAscii), key, value }
}

/** Keys in the file's order, then any new ones (sorted, as Jupyter writes them). */
function keyOrder(present: Iterable<string>, recorded: readonly string[]): string[] {
  const keys = new Set(present)
  const ordered = recorded.filter((key) => keys.has(key))
  const known = new Set(ordered)
  return [...ordered, ...[...keys].filter((key) => !known.has(key)).sort()]
}

function jsonMapNode(map: Y.Map<string> | null, recorded: readonly string[], style: JsonStyle): JsonNode {
  if (!map) return { kind: 'object', entries: [] }
  const entries: JsonEntry[] = []
  for (const key of keyOrder(map.keys(), recorded)) {
    const raw = map.get(key)
    if (typeof raw !== 'string') continue
    try {
      entries.push(entryNode(key, parseJson(raw), style))
    } catch {
      // A value another client damaged is dropped rather than written as invalid JSON.
    }
  }
  return { kind: 'object', entries }
}

function extraEntries(extra: [string, string][], style: JsonStyle): Map<string, JsonNode> {
  const nodes = new Map<string, JsonNode>()
  for (const [key, raw] of extra) {
    try {
      nodes.set(key, parseJson(raw))
    } catch {
      // As above.
    }
  }
  void style
  return nodes
}

async function cellNode(cell: Y.Map<unknown>, id: string | undefined, style: JsonStyle, assets: LiveAssetStore, budget: RestoreBudget): Promise<JsonNode> {
  const type = cellType(cell)
  const fields = new Map<string, JsonNode>()
  if (id !== undefined) fields.set('id', { kind: 'string', raw: quote(id, style.ensureAscii), value: id })
  fields.set('cell_type', { kind: 'string', raw: quote(type, style.ensureAscii), value: type })
  fields.set('metadata', jsonMapNode(cellMetadata(cell), stringList(cell.get('metadataKeys')), style))
  fields.set('source', textNode(cellSourceText(cell), cell.get('sourceShape') === 'string' ? 'string' : 'lines', style))
  if (type === 'code') {
    const count = cellExecutionCount(cell)
    fields.set('execution_count', count === null ? { kind: 'literal', raw: 'null' } : { kind: 'number', raw: String(count) })
    fields.set('outputs', await blobNode(cellOutputs(cell), assets, style, budget))
  } else {
    const attachments = cellAttachments(cell)
    if (attachments) fields.set('attachments', await blobNode(attachments, assets, style, budget))
  }
  for (const [key, value] of extraEntries(stringPairs(cell.get('extra')), style)) if (!fields.has(key)) fields.set(key, value)
  return {
    kind: 'object',
    entries: keyOrder(fields.keys(), stringList(cell.get('keys'))).map((key) => entryNode(key, fields.get(key)!, style)),
  }
}

/** The cells' nbformat ids as they will be written: present, valid, and unique where the notebook needs them. */
function exportIds(doc: Y.Doc, cells: { key: string; cell: Y.Map<unknown> }[]): (string | undefined)[] {
  const map = notebookMap(doc)
  const minor = map.get('nbformat_minor')
  const required = typeof minor === 'number' && minor >= 5
  const seen = new Set<string>()
  return cells.map(({ key, cell }) => {
    const stored = cell.get('id')
    let id = typeof stored === 'string' && (!required || CELL_ID_PATTERN.test(stored)) ? stored : required ? key.slice(0, 8) : undefined
    if (id === undefined) return undefined
    const base = id
    for (let suffix = 2; seen.has(id); suffix += 1) id = `${base.slice(0, 60)}-${suffix}`
    seen.add(id)
    return id
  })
}

async function notebookText(doc: Y.Doc, facts: FileFacts, assets: LiveAssetStore): Promise<string> {
  const { style } = facts
  const map = notebookMap(doc)
  const cells = orderedCells(doc)
  const ids = exportIds(doc, cells)
  // One budget for the whole file: see `RestoreBudget`.
  const budget = restoreBudget()
  const cellNodes = await Promise.all(cells.map((entry, index) => cellNode(entry.cell, ids[index], style, assets, budget)))
  const nbformat = map.get('nbformat')
  const minor = map.get('nbformat_minor')
  const fields = new Map<string, JsonNode>([
    ['cells', { kind: 'array', items: cellNodes }],
    ['metadata', jsonMapNode(notebookMetadata(doc), facts.metadataKeys, style)],
    ['nbformat', { kind: 'number', raw: String(typeof nbformat === 'number' ? nbformat : 4) }],
    ['nbformat_minor', { kind: 'number', raw: String(typeof minor === 'number' ? minor : 5) }],
  ])
  for (const [key, value] of extraEntries(facts.extra, style)) if (!fields.has(key)) fields.set(key, value)
  const root: JsonNode = { kind: 'object', entries: keyOrder(fields.keys(), facts.keys).map((key) => entryNode(key, fields.get(key)!, style)) }
  return writeDocument(root, style)
}

function encode(text: string, style: JsonStyle): Uint8Array {
  const body = new TextEncoder().encode(text)
  if (!style.bom) return body
  const bytes = new Uint8Array(body.byteLength + 3)
  bytes.set([0xef, 0xbb, 0xbf])
  bytes.set(body, 3)
  return bytes
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let index = 0; index < a.byteLength; index += 1) if (a[index] !== b[index]) return false
  return true
}

/** The notebook as file bytes, in the layout it was read with. */
export async function exportNotebookFile(doc: Y.Doc, context: Pick<LiveFormatContext, 'assets'>): Promise<Uint8Array> {
  const facts = readFacts(doc)
  const bytes = encode(await notebookText(doc, facts, context.assets), facts.style)
  if (facts.original && globalThis.crypto?.subtle && await liveAssetHash(bytes) === facts.original.exportHash) {
    try {
      const original = await context.assets.get(facts.original.asset)
      // Another client could point `original` at any asset; only a notebook is returned as one.
      readNotebookFile(original)
      return original
    } catch {
      // A missing original only costs the file's exact layout; everything in it is still here.
    }
  }
  return bytes
}

/**
 * Remembers the file's own bytes when writing the document back would not give them exactly
 * (an upgraded nbformat 3 file, unusual escapes or line splits), so it exports unchanged until edited.
 */
async function keepOriginal(doc: Y.Doc, bytes: Uint8Array, assets: LiveAssetStore): Promise<FileFacts['original'] | undefined> {
  const written = encode(await notebookText(doc, readFacts(doc), assets), readFacts(doc).style)
  if (sameBytes(written, bytes)) return undefined
  const ref = await assets.put(bytes, NOTEBOOK_MIME_TYPE)
  return { asset: ref.hash, exportHash: await liveAssetHash(written) }
}

function fillNotebook(doc: Y.Doc, parsed: ParsedNotebook, cells: PreparedCell[]): void {
  writeNotebookFacts(doc, parsed)
  const map = cellsMap(doc)
  for (const key of [...map.keys()]) map.delete(key)
  const orders = initialOrderKeys(cells.length)
  cells.forEach((cell, index) => map.set(newCellKey(), createCellMap(cellInit(cell), orders[index]!)))
}

function setOriginal(doc: Y.Doc, original: FileFacts['original'] | undefined): void {
  setIfChanged(notebookMap(doc), 'original', original)
}

// Applying a new version of the file as a minimal diff.

function blobEquals(a: NotebookBlob | null | undefined, b: NotebookBlob | null | undefined): boolean {
  return sameJson(a ?? null, b ?? null)
}

/**
 * `keepIds`: the file's ids are not to be trusted over the cell's own, either because nbformat 3's
 * upgrade makes new random ones each time, or because a 4.5+ file left them out (an older writer).
 */
function updateCell(cell: Y.Map<unknown>, prepared: PreparedCell, keepIds: boolean): void {
  const { parsed } = prepared
  const existing = cell.get('id')
  if (!(keepIds && typeof existing === 'string')) setIfChanged(cell, 'id', parsed.id)
  if (cellType(cell) !== parsed.type) cell.set('cell_type', parsed.type)
  const source = cell.get('source')
  if (source instanceof Y.Text) applyTextToYText(source, parsed.source)
  else cell.set('source', new Y.Text(parsed.source))
  setIfChanged(cell, 'sourceShape', parsed.sourceShape)
  const metadata = cellMetadata(cell)
  if (metadata) syncJsonMap(metadata, parsed.metadata)
  else cell.set('metadata', new Y.Map<string>(parsed.metadata.map((item) => [item.key, compactJson(item.value)])))
  setIfChanged(cell, 'metadataKeys', parsed.metadata.length ? parsed.metadata.map((item) => item.key) : undefined)
  setIfChanged(cell, 'keys', parsed.keys)
  if (parsed.type === 'code') {
    setIfChanged(cell, 'execution_count', parsed.executionCount ?? null)
    if (!blobEquals(isNotebookBlob(cell.get('outputs')) ? cellOutputs(cell) : null, prepared.outputs)) cell.set('outputs', prepared.outputs)
  } else {
    if (cell.has('execution_count')) cell.delete('execution_count')
    if (cell.has('outputs')) cell.delete('outputs')
  }
  if (!blobEquals(cellAttachments(cell), prepared.attachments)) setIfChanged(cell, 'attachments', prepared.attachments)
  setIfChanged(cell, 'extra', parsed.extra.length ? entryPairs(parsed.extra) : undefined)
}

/**
 * `random` makes new cells' keys and positions: applyFile seeds it, so the scratch run that works out
 * the export and the real run make the same document (new 4.5 cells without ids take their key's).
 */
function applyNotebook(doc: Y.Doc, parsed: ParsedNotebook, prepared: PreparedCell[], random: () => number): void {
  writeNotebookFacts(doc, parsed)
  const keepIds = (cell: PreparedCell) => parsed.upgraded || (cell.parsed.id === undefined && parsed.nbformatMinor >= 5)
  const current = orderedCells(doc)
  const matches = matchCells(
    current.map(({ key, cell }) => ({ key, id: typeof cell.get('id') === 'string' ? cell.get('id') as string : undefined, type: cellType(cell), source: cellSourceText(cell) })),
    prepared.map(({ parsed: cell }) => ({ id: cell.id, type: cell.type, source: cell.source })),
  )
  const map = cellsMap(doc)
  const matched = new Set(matches.filter((key): key is string => key !== null))
  for (const { key } of current) if (!matched.has(key)) map.delete(key)
  // Matched cells that stay in order keep their keys; the rest (moved or new) get keys between them.
  const index = new Map(current.map((entry, at) => [entry.key, at]))
  const matchedPositions = matches.flatMap((key, at) => (key === null ? [] : [{ at, position: index.get(key)! }]))
  const kept = longestIncreasing(matchedPositions.map((item) => item.position))
  const stays = new Set(matchedPositions.filter((_, at) => kept.has(at)).map((item) => item.at))
  let previousOrder: string | null = null
  prepared.forEach((cell, at) => {
    const key = matches[at] ?? null
    if (key !== null && stays.has(at)) {
      const target = map.get(key)!
      updateCell(target, cell, keepIds(cell))
      previousOrder = target.get('order') as string
      return
    }
    // The next cell that keeps its place bounds this one.
    let nextOrder: string | null = null
    for (let later = at + 1; later < prepared.length; later += 1) {
      const laterKey = matches[later] ?? null
      if (laterKey !== null && stays.has(later)) {
        nextOrder = map.get(laterKey)!.get('order') as string
        break
      }
    }
    const order = orderKeyBetween(previousOrder, nextOrder, random)
    if (key !== null) {
      const target = map.get(key)!
      target.set('order', order)
      updateCell(target, cell, keepIds(cell))
    } else {
      map.set(newCellKey(random), createCellMap(cellInit(cell), order))
    }
    previousOrder = order
  })
}

// Plain text for agents, search, and previews.

const OUTPUT_LINES = 30
const OUTPUT_CHARACTERS = 3_000

function sizeLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const STORED = '(long, kept as an asset; pull the notebook to read it)'

/** Whether a value is a placeholder for a part kept as an asset. */
function stored(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ASSET_MARKER)
}

function joined(value: unknown): string | null {
  if (stored(value)) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join('')
  return null
}

function quoted(text: string): string[] {
  let body = text.length > OUTPUT_CHARACTERS ? text.slice(0, OUTPUT_CHARACTERS) : text
  // ANSI colors are for terminals.
  // oxlint-disable-next-line no-control-regex -- matches ANSI escape sequences
  body = body.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
  const lines = body.replace(/\n$/, '').split('\n')
  const shown = lines.slice(0, OUTPUT_LINES).map((line) => `#   ${line}`.trimEnd())
  const hidden = lines.length - shown.length + (text.length > OUTPUT_CHARACTERS ? 1 : 0)
  if (hidden > 0) shown.push(`#   … (${text.length.toLocaleString('en-US')} characters in all)`)
  return shown
}

function placeholderSize(value: string, blob: NotebookBlob): string | null {
  if (!value.startsWith(ASSET_MARKER)) return null
  const slot = blob.assets[Number(value.slice(ASSET_MARKER.length))]
  return slot?.kind === 'base64' ? 'stored as an asset' : 'long, stored as an asset'
}

function outputLines(output: unknown, blob: NotebookBlob): string[] {
  if (typeof output !== 'object' || output === null) return []
  const record = output as Record<string, unknown>
  switch (record.output_type) {
    case 'stream': {
      const name = record.name === 'stderr' ? 'stderr' : 'stdout'
      const text = joined(record.text)
      if (text === null) return [`# ${name}: ${stored(record.text) ? STORED : '(unreadable)'}`]
      return [`# ${name}:`, ...quoted(text)]
    }
    case 'error':
      return [`# Error: ${String(record.ename ?? 'Error')}: ${String(record.evalue ?? '')}`.trimEnd()]
    case 'execute_result':
    case 'display_data': {
      const label = record.output_type === 'execute_result' && typeof record.execution_count === 'number' ? `# Out [${record.execution_count}]:` : '# Output:'
      if (stored(record.data)) return [`${label} ${STORED}`]
      const data = typeof record.data === 'object' && record.data !== null ? record.data as Record<string, unknown> : {}
      const lines = [label]
      const plain = joined(data['text/plain'])
      const markdown = joined(data['text/markdown'])
      for (const [mime, value] of Object.entries(data)) {
        if (mime === 'text/plain' || (mime === 'text/markdown' && markdown !== null)) continue
        const text = joined(value)
        const kept = typeof value === 'string' ? placeholderSize(value, blob) : null
        lines.push(`#   [${mime}${kept ? `, ${kept}` : text !== null ? `, ${sizeLabel(text.length)}` : ''}]`)
      }
      if (markdown !== null) for (const line of quoted(markdown)) lines.push(line)
      else if (plain !== null) for (const line of quoted(plain)) lines.push(line)
      else if (stored(data['text/plain'])) lines.push(`#   ${STORED}`)
      return lines
    }
    default:
      return []
  }
}

/**
 * The notebook as readable text: each cell under a `# %%` marker (as Jupytext and editors write
 * cells in scripts) with its type, number, and id, and code cells' outputs summarized below as
 * comments. Agents `cat` and `grep` it; `pull` gives them the real file.
 */
export function notebookToText(doc: Y.Doc): string {
  const cells = orderedCells(doc)
  const kernel = notebookKernelName(doc)
  const lines: string[] = [`# Jupyter notebook${kernel ? ` · ${kernel}` : ''} · ${cells.length === 1 ? '1 cell' : `${cells.length} cells`}`]
  cells.forEach(({ cell }, index) => {
    const type = cellType(cell)
    const id = cell.get('id')
    const count = cellExecutionCount(cell)
    lines.push('', `# %% [${type}] cell ${index + 1}${type === 'code' ? ` · In [${count ?? ' '}]` : ''}${typeof id === 'string' ? ` · id ${id}` : ''}`)
    const source = cellSourceText(cell)
    if (source) lines.push(source.replace(/\n$/, ''))
    if (type !== 'code') return
    const blob = cellOutputs(cell)
    let outputs: unknown
    try {
      outputs = JSON.parse(blob.json)
    } catch {
      outputs = []
    }
    if (stored(outputs)) lines.push(`# Outputs: ${STORED}`)
    for (const output of Array.isArray(outputs) ? outputs : []) {
      for (const line of stored(output) ? [`# Output: ${STORED}`] : outputLines(output, blob)) lines.push(line)
    }
  })
  // Placeholders inside joined text (one long line of a list) never reach agents as NUL bytes.
  // oxlint-disable-next-line no-control-regex -- the placeholder starts with NUL
  return `${lines.join('\n').replace(/\u0000pulpo-asset:\d+/g, '…(long, kept as an asset)')}\n`
}

function referenced(doc: Y.Doc): string[] {
  const hashes = new Set<string>()
  const original = readFacts(doc).original
  if (original) hashes.add(original.asset)
  for (const { cell } of orderedCells(doc)) {
    for (const blob of [cellOutputs(cell), cellAttachments(cell)]) for (const slot of blob?.assets ?? []) hashes.add(slot.hash)
  }
  return [...hashes]
}

/**
 * Jupyter notebooks. Cells live in a Y.Map ordered by fractional keys, each cell's source a Y.Text
 * that editors bind to, and outputs as one value per cell with images kept as assets (see
 * `layout.ts`). The file is written back in its own JSON layout, so an unedited notebook exports
 * byte for byte and an edited one differs only where it was edited.
 */
export const notebookCodec: LiveFormatCodec = {
  id: 'notebook',
  schemaVersion: NOTEBOOK_SCHEMA_VERSION,
  extensions: NOTEBOOK_EXTENSIONS,
  mimeType: () => NOTEBOOK_MIME_TYPE,

  async createEmpty(doc) {
    // What JupyterLab writes for a new Python notebook, with one empty code cell.
    const metadata = {
      kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    }
    doc.transact(() => {
      const map = notebookMap(doc)
      map.set('nbformat', 4)
      map.set('nbformat_minor', 5)
      map.set('style', Object.fromEntries(STYLE_KEYS.map((key) => [key, JUPYTER_STYLE[key]])))
      map.set('keys', ['cells', 'metadata', 'nbformat', 'nbformat_minor'])
      const meta = notebookMetadata(doc)
      for (const [key, value] of Object.entries(metadata)) meta.set(key, JSON.stringify(value))
      const key = newCellKey()
      cellsMap(doc).set(key, createCellMap({ type: 'code', source: '', id: key.slice(0, 8) }, initialOrderKeys(1)[0]!))
    }, 'import')
  },

  async importFile(doc, bytes, context) {
    const parsed = readNotebookFile(bytes)
    const cells = uniqueIds(await prepareCells(parsed, context.assets))
    // Validate the normalized export too, before changing the caller's document.
    const scratch = new Y.Doc()
    try {
      fillNotebook(scratch, parsed, cells)
      const original = await keepOriginal(scratch, bytes, context.assets)
      doc.transact(() => {
        fillNotebook(doc, parsed, cells)
        setOriginal(doc, original)
      }, 'import')
    } finally {
      scratch.destroy()
    }
  },

  exportFile: exportNotebookFile,

  async applyFile(doc, bytes, context, origin) {
    const parsed = readNotebookFile(bytes)
    const cells = uniqueIds(await prepareCells(parsed, context.assets))
    // The original is worked out on a scratch copy, so the document changes in one transaction.
    const seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!
    const scratch = new Y.Doc()
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc))
    let original: FileFacts['original']
    try {
      applyNotebook(scratch, parsed, cells, seededRandom(seed))
      setOriginal(scratch, undefined)
      original = await keepOriginal(scratch, bytes, context.assets)
    } finally {
      scratch.destroy()
    }
    const changed = transactChanges(doc, () => {
      applyNotebook(doc, parsed, cells, seededRandom(seed))
      setOriginal(doc, original)
    }, origin)
    return { changed }
  },

  toText: notebookToText,

  referencedAssets: referenced,
}

export type { ParsedNotebook }
export { LiveFormatError }
