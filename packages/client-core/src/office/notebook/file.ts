import type { LiveAssetStore } from '../live-format.js'
import { LiveFormatError } from '../live-format.js'
import {
  compactJson,
  detectStyle,
  JUPYTER_STYLE,
  jsonNode,
  parseJson,
  parseJsonDocument,
  quote,
  stringNode,
  type JsonEntry,
  type JsonNode,
  type JsonStyle,
} from './json.js'
import { ASSET_MARKER, NOTEBOOK_MAX_CELLS, NOTEBOOK_MAX_FILE_BYTES, type NotebookAssetSlot, type NotebookBlob, type NotebookCellType } from './layout.js'

/**
 * Notebook files as the codec reads and writes them: validated against the nbformat 4 rules the
 * editor relies on, with everything else kept as written. nbformat 3 files are upgraded to 4.5 on
 * the way in, as Jupyter does when it opens them.
 */

export interface ParsedCell {
  /** The cell's keys in the file's order. */
  keys: string[]
  /** The nbformat id, if the cell has one. */
  id: string | undefined
  type: NotebookCellType
  source: string
  sourceShape: 'lines' | 'string'
  metadata: JsonEntry[]
  /** Code cells only; undefined when the key is absent. */
  executionCount: number | null | undefined
  outputs: JsonNode | undefined
  attachments: JsonNode | undefined
  extra: JsonEntry[]
}

export interface ParsedNotebook {
  style: JsonStyle
  nbformat: number
  nbformatMinor: number
  keys: string[]
  metadata: JsonEntry[]
  extra: JsonEntry[]
  cells: ParsedCell[]
  /** Whether the file was upgraded from nbformat 3, so it can never be written back as it was. */
  upgraded: boolean
}

const TOP_KEYS = new Set(['cells', 'metadata', 'nbformat', 'nbformat_minor'])
const CODE_KEYS = new Set(['id', 'cell_type', 'metadata', 'source', 'outputs', 'execution_count'])
const TEXT_KEYS = new Set(['id', 'cell_type', 'metadata', 'source', 'attachments'])
const OUTPUT_TYPES = new Set(['stream', 'display_data', 'execute_result', 'error'])
/** nbformat 4.5 cell ids. */
export const CELL_ID_PATTERN = /^[a-zA-Z0-9-_]{1,64}$/

function corrupt(message: string): LiveFormatError {
  return new LiveFormatError('corrupt', message)
}

type ObjectNode = Extract<JsonNode, { kind: 'object' }>

function entry(node: ObjectNode, key: string): JsonNode | undefined {
  for (let index = node.entries.length - 1; index >= 0; index -= 1) if (node.entries[index]!.key === key) return node.entries[index]!.value
  return undefined
}

function isInteger(node: JsonNode | undefined): node is Extract<JsonNode, { kind: 'number' }> {
  return node?.kind === 'number' && /^-?\d+$/.test(node.raw)
}

/** nbformat text: a string, or a list of strings to join. */
function readText(node: JsonNode | undefined, what: string): { text: string; shape: 'lines' | 'string' } {
  if (!node) return { text: '', shape: 'lines' }
  if (node.kind === 'string') return { text: node.value, shape: 'string' }
  if (node.kind === 'array' && node.items.every((item) => item.kind === 'string')) {
    return { text: node.items.map((item) => (item as Extract<JsonNode, { kind: 'string' }>).value).join(''), shape: 'lines' }
  }
  throw corrupt(`${what} must be text`)
}

function requireObject(node: JsonNode | undefined, what: string): ObjectNode {
  if (node?.kind !== 'object') throw corrupt(`${what} must be an object`)
  return node
}

function validateOutput(node: JsonNode, index: number): void {
  const output = requireObject(node, `Output ${index + 1}`)
  const type = entry(output, 'output_type')
  if (type?.kind !== 'string' || !OUTPUT_TYPES.has(type.value)) throw corrupt(`Output ${index + 1} has an unknown output_type`)
  switch (type.value) {
    case 'stream':
      if (entry(output, 'name')?.kind !== 'string') throw corrupt('A stream output has no name')
      readText(entry(output, 'text'), 'A stream output')
      break
    case 'display_data':
    case 'execute_result': {
      requireObject(entry(output, 'data'), 'Output data')
      const metadata = entry(output, 'metadata')
      if (metadata) requireObject(metadata, 'Output metadata')
      if (type.value === 'execute_result') {
        const count = entry(output, 'execution_count')
        if (count && !isInteger(count) && !(count.kind === 'literal' && count.raw === 'null')) throw corrupt('An execution count must be a number')
      }
      break
    }
    case 'error': {
      if (entry(output, 'ename')?.kind !== 'string' || entry(output, 'evalue')?.kind !== 'string') throw corrupt('An error output has no name or value')
      const traceback = entry(output, 'traceback')
      if (traceback?.kind !== 'array' || !traceback.items.every((item) => item.kind === 'string')) throw corrupt('An error output has no traceback')
      break
    }
  }
}

function readCell(node: JsonNode, index: number): ParsedCell {
  const cell = requireObject(node, `Cell ${index + 1}`)
  const typeNode = entry(cell, 'cell_type')
  const type = typeNode?.kind === 'string' ? typeNode.value : null
  if (type !== 'code' && type !== 'markdown' && type !== 'raw') throw corrupt(`Cell ${index + 1} has an unknown cell_type`)
  const idNode = entry(cell, 'id')
  if (idNode && idNode.kind !== 'string') throw corrupt(`Cell ${index + 1} has an id that is not text`)
  const metadataNode = entry(cell, 'metadata')
  const metadata = metadataNode ? requireObject(metadataNode, `Cell ${index + 1} metadata`).entries : []
  const { text: source, shape: sourceShape } = readText(entry(cell, 'source'), `Cell ${index + 1} source`)
  const known = type === 'code' ? CODE_KEYS : TEXT_KEYS
  let executionCount: number | null | undefined
  let outputs: JsonNode | undefined
  let attachments: JsonNode | undefined
  if (type === 'code') {
    const count = entry(cell, 'execution_count')
    if (count) {
      if (isInteger(count)) executionCount = Number(count.raw)
      else if (count.kind === 'literal' && count.raw === 'null') executionCount = null
      else throw corrupt(`Cell ${index + 1} has an execution count that is not a number`)
    }
    outputs = entry(cell, 'outputs')
    if (outputs) {
      if (outputs.kind !== 'array') throw corrupt(`Cell ${index + 1} outputs must be a list`)
      outputs.items.forEach(validateOutput)
    }
  } else {
    attachments = entry(cell, 'attachments')
    if (attachments) {
      for (const attachment of requireObject(attachments, `Cell ${index + 1} attachments`).entries) requireObject(attachment.value, 'An attachment')
    }
  }
  const keys = [...new Set(cell.entries.map((item) => item.key))]
  return {
    keys,
    id: idNode?.kind === 'string' ? idNode.value : undefined,
    type,
    source,
    sourceShape,
    metadata,
    executionCount,
    outputs,
    attachments,
    extra: cell.entries.filter((item) => !known.has(item.key)),
  }
}

// nbformat 3 named output data by short keys (nbformat.v4.convert's `_mime_map`).
const V3_MIME: Record<string, string> = {
  text: 'text/plain',
  html: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpeg: 'image/jpeg',
  latex: 'text/latex',
  json: 'application/json',
  javascript: 'application/javascript',
}

/** Random 8-hex ids, as nbformat's `random_cell_id` makes them. */
export function randomCellId(): string {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function object(entries: [string, JsonNode][], style: JsonStyle): ObjectNode {
  return { kind: 'object', entries: entries.map(([key, value]) => ({ raw: quote(key, style.ensureAscii), key, value })) }
}

/** An nbformat 3 output as nbformat 4 writes it (`nbformat.v4.convert.upgrade_output`). */
function upgradeOutput(node: JsonNode): JsonNode {
  if (node.kind !== 'object') return node
  const type = entry(node, 'output_type')
  const typeName = type?.kind === 'string' ? type.value : ''
  const style = JUPYTER_STYLE
  if (typeName === 'pyout' || typeName === 'display_data') {
    const data: [string, JsonNode][] = []
    let metadata: JsonNode = { kind: 'object', entries: [] }
    let count: JsonNode | undefined
    for (const item of node.entries) {
      if (item.key === 'output_type') continue
      if (item.key === 'metadata') {
        metadata = item.value.kind === 'object'
          ? object(item.value.entries.map((meta) => [V3_MIME[meta.key] ?? meta.key, meta.value]), style)
          : item.value
        continue
      }
      if (item.key === 'prompt_number') {
        count = item.value
        continue
      }
      const mime = V3_MIME[item.key] ?? item.key
      let value = item.value
      if (mime === 'application/json' && value.kind === 'string') {
        try {
          value = parseJson(value.value)
        } catch {
          // Kept as the text it was.
        }
      }
      data.push([mime, value])
    }
    const entries: [string, JsonNode][] = [['data', object(data, style)], ['metadata', metadata], ['output_type', stringNode(typeName === 'pyout' ? 'execute_result' : 'display_data')]]
    if (typeName === 'pyout') entries.push(['execution_count', count ?? { kind: 'literal', raw: 'null' }])
    return object(entries, style)
  }
  if (typeName === 'pyerr') return object(node.entries.map((item) => [item.key, item.key === 'output_type' ? stringNode('error') : item.value]), style)
  if (typeName === 'stream') {
    return object(node.entries.map((item) => [item.key === 'stream' ? 'name' : item.key, item.value]), style)
  }
  return node
}

/** An nbformat 3 notebook as nbformat 4.5 (`nbformat.v4.convert.upgrade`). */
function upgradeV3(root: ObjectNode): ObjectNode {
  const style = JUPYTER_STYLE
  const cells: JsonNode[] = []
  const worksheets = entry(root, 'worksheets')
  for (const sheet of worksheets?.kind === 'array' ? worksheets.items : []) {
    const sheetCells = sheet.kind === 'object' ? entry(sheet, 'cells') : undefined
    for (const raw of sheetCells?.kind === 'array' ? sheetCells.items : []) {
      if (raw.kind !== 'object') throw corrupt('A cell must be an object')
      const type = entry(raw, 'cell_type')
      const typeName = type?.kind === 'string' ? type.value : ''
      const metadataNode = entry(raw, 'metadata')
      const metadata: [string, JsonNode][] = metadataNode?.kind === 'object' ? metadataNode.entries.map((item) => [item.key, item.value]) : []
      const id = stringNode(randomCellId())
      if (typeName === 'code') {
        const collapsed = entry(raw, 'collapsed')
        if (collapsed) metadata.push(['collapsed', collapsed])
        const outputs = entry(raw, 'outputs')
        cells.push(object([
          ['cell_type', stringNode('code')],
          ['execution_count', entry(raw, 'prompt_number') ?? { kind: 'literal', raw: 'null' }],
          ['id', id],
          ['metadata', object(metadata, style)],
          ['outputs', { kind: 'array', items: outputs?.kind === 'array' ? outputs.items.map(upgradeOutput) : [] }],
          ['source', entry(raw, 'input') ?? stringNode('')],
        ], style))
      } else if (typeName === 'heading') {
        const level = entry(raw, 'level')
        const hashes = '#'.repeat(isInteger(level) ? Math.min(6, Math.max(1, Number(level.raw))) : 1)
        const text = readText(entry(raw, 'source'), 'A heading').text
        cells.push(object([
          ['cell_type', stringNode('markdown')], ['id', id], ['metadata', object(metadata, style)],
          ['source', textNode(`${hashes} ${text.split(/\r\n|\r|\n/).join(' ')}`, 'lines', style)],
        ], style))
      } else if (typeName === 'markdown' || typeName === 'raw' || typeName === 'html') {
        cells.push(object([
          ['cell_type', stringNode(typeName === 'raw' ? 'raw' : 'markdown')], ['id', id], ['metadata', object(metadata, style)],
          ['source', entry(raw, 'source') ?? stringNode('')],
        ], style))
      } else {
        throw corrupt('A cell has an unknown cell_type')
      }
    }
  }
  const metadataNode = entry(root, 'metadata')
  const metadata: [string, JsonNode][] = (metadataNode?.kind === 'object' ? metadataNode.entries : [])
    .filter((item) => item.key !== 'name' && item.key !== 'signature')
    .map((item) => [item.key, item.value])
  const minor = entry(root, 'nbformat_minor')
  metadata.push(['orig_nbformat', { kind: 'number', raw: '3' }], ['orig_nbformat_minor', isInteger(minor) ? minor : { kind: 'number', raw: '0' }])
  const extra = root.entries.filter((item) => !['worksheets', 'metadata', 'nbformat', 'nbformat_minor', 'orig_nbformat', 'orig_nbformat_minor'].includes(item.key))
  return object([
    ['cells', { kind: 'array', items: cells }],
    ['metadata', object(metadata, style)],
    ['nbformat', { kind: 'number', raw: '4' }],
    ['nbformat_minor', { kind: 'number', raw: '5' }],
    ...extra.map((item): [string, JsonNode] => [item.key, item.value]),
  ], style)
}

/** The file's text: UTF-8, with or without a byte order mark. */
export function decodeNotebookBytes(bytes: Uint8Array): { text: string; bom: boolean } {
  if (bytes.byteLength > NOTEBOOK_MAX_FILE_BYTES) throw new LiveFormatError('too_large', 'This notebook is too large to edit')
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes), bom }
  } catch (cause) {
    throw new LiveFormatError('corrupt', 'This notebook is not UTF-8 text', { cause })
  }
}

/** Reads and validates a notebook file. Throws `LiveFormatError` for anything that is not an nbformat 3 or 4 notebook. */
export function readNotebookFile(bytes: Uint8Array): ParsedNotebook {
  const { text, bom } = decodeNotebookBytes(bytes)
  if (!text.trim()) throw corrupt('The notebook is empty')
  const { root: parsed, separators } = parseJsonDocument(text)
  let root = requireObject(parsed, 'A notebook')
  const nbformatNode = entry(root, 'nbformat')
  if (!isInteger(nbformatNode)) throw corrupt('The notebook has no nbformat version')
  const nbformat = Number(nbformatNode.raw)
  let style = detectStyle(text, root, separators, bom)
  let upgraded = false
  if (nbformat === 3) {
    root = upgradeV3(root)
    style = { ...JUPYTER_STYLE, bom }
    upgraded = true
  } else if (nbformat !== 4) {
    throw new LiveFormatError('unsupported', `Notebook format ${nbformat} is not supported`)
  }
  const minorNode = entry(root, 'nbformat_minor')
  if (!isInteger(minorNode)) throw corrupt('The notebook has no nbformat_minor version')
  const cellsNode = entry(root, 'cells')
  if (cellsNode?.kind !== 'array') throw corrupt('The notebook has no list of cells')
  if (cellsNode.items.length > NOTEBOOK_MAX_CELLS) throw new LiveFormatError('too_large', 'This notebook has too many cells to edit')
  const metadataNode = entry(root, 'metadata')
  const metadata = metadataNode ? requireObject(metadataNode, 'The notebook metadata').entries : []
  return {
    style,
    nbformat: 4,
    nbformatMinor: Number(minorNode.raw),
    keys: [...new Set(root.entries.map((item) => item.key))],
    metadata: dedupe(metadata),
    extra: dedupe(root.entries.filter((item) => !TOP_KEYS.has(item.key))),
    cells: cellsNode.items.map(readCell).map((cell) => ({ ...cell, metadata: dedupe(cell.metadata), extra: dedupe(cell.extra) })),
    upgraded,
  }
}

/** JSON objects may repeat a key; the last one wins, as in Python and JavaScript. */
function dedupe(entries: JsonEntry[]): JsonEntry[] {
  const last = new Map<string, number>()
  entries.forEach((item, index) => last.set(item.key, index))
  return entries.filter((item, index) => last.get(item.key) === index)
}

// Outputs and attachments: their large parts move to assets.

/** Strings and lists of at least this many characters of JSON become assets. */
export const BLOB_ASSET_THRESHOLD = 16_384
/** Base64 data of at least this many characters (about 750 bytes) becomes an asset. */
const BASE64_ASSET_THRESHOLD = 1_000
const BASE64_MIME = /^image\/(?!svg)[a-z0-9.+-]+$|^application\/pdf$/i

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP = new Int16Array(128).fill(-1)
for (let index = 0; index < BASE64_ALPHABET.length; index += 1) BASE64_LOOKUP[BASE64_ALPHABET.charCodeAt(index)] = index

/** Decodes canonical, padded base64, or returns null. */
export function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((text.length / 4) * 3 - padding)
  let out = 0
  for (let index = 0; index < text.length; index += 4) {
    const values = [0, 1, 2, 3].map((offset) => {
      const code = text.charCodeAt(index + offset)
      if (code === 61 && index + offset >= text.length - padding) return 0
      return code < 128 ? BASE64_LOOKUP[code]! : -1
    })
    if (values.some((value) => value < 0)) return null
    const triple = (values[0]! << 18) | (values[1]! << 12) | (values[2]! << 6) | values[3]!
    if (out < bytes.length) bytes[out++] = (triple >> 16) & 0xff
    if (out < bytes.length) bytes[out++] = (triple >> 8) & 0xff
    if (out < bytes.length) bytes[out++] = triple & 0xff
  }
  return bytes
}

export function encodeBase64(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const triple = (bytes[index]! << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0)
    text += BASE64_ALPHABET[(triple >> 18) & 63]! + BASE64_ALPHABET[(triple >> 12) & 63]!
    text += index + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63]! : '='
    text += index + 2 < bytes.length ? BASE64_ALPHABET[triple & 63]! : '='
  }
  return text
}

/** Base64 as it is laid out in the file: wrapped every `wrap` characters (0 for one line), then `trail`. */
function layBase64(base64: string, wrap: number, trail: string): string {
  if (!wrap) return base64 + trail
  const lines: string[] = []
  for (let index = 0; index < base64.length; index += wrap) lines.push(base64.slice(index, index + wrap))
  return lines.join('\n') + trail
}

/** Splits base64 data as written into its bytes and layout, or null when it would not be written back the same. */
function readBase64(value: string): { bytes: Uint8Array; wrap: number; trail: string } | null {
  const trail = /\n*$/.exec(value)![0]
  const body = value.slice(0, value.length - trail.length)
  const lines = body.split('\n')
  const wrap = lines.length > 1 ? lines[0]!.length : 0
  const base64 = lines.join('')
  const bytes = decodeBase64(base64)
  if (!bytes || layBase64(encodeBase64(bytes), wrap, trail) !== value) return null
  return { bytes, wrap, trail }
}

function markerNode(index: number): JsonNode {
  return stringNode(`${ASSET_MARKER}${index}`)
}

function sizeOf(node: JsonNode, sizes: Map<JsonNode, number>): number {
  const known = sizes.get(node)
  if (known !== undefined) return known
  // Computed bottom-up without recursion, so deep outputs cannot overflow the stack.
  const stack: [JsonNode, boolean][] = [[node, false]]
  while (stack.length) {
    const [current, visited] = stack.pop()!
    if (sizes.has(current)) continue
    if (current.kind === 'string' || current.kind === 'number' || current.kind === 'literal') {
      sizes.set(current, current.raw.length)
      continue
    }
    const children = current.kind === 'array' ? current.items : current.entries.map((item) => item.value)
    if (!visited) {
      stack.push([current, true])
      for (const child of children) if (!sizes.has(child)) stack.push([child, false])
      continue
    }
    let size = 2 + Math.max(0, children.length - 1)
    if (current.kind === 'object') for (const item of current.entries) size += item.raw.length + 1
    for (const child of children) size += sizes.get(child)!
    sizes.set(current, size)
  }
  return sizes.get(node)!
}

function containsMarker(node: JsonNode): boolean {
  const stack = [node]
  while (stack.length) {
    const current = stack.pop()!
    if (current.kind === 'string' && current.value.startsWith(ASSET_MARKER)) return true
    if (current.kind === 'array') stack.push(...current.items)
    if (current.kind === 'object') for (const item of current.entries) stack.push(item.value)
  }
  return false
}

/**
 * Outputs or attachments as kept in the Y.Doc: compact JSON whose images (base64 under an image
 * type) and long values are replaced by placeholders for assets, so a notebook full of plots syncs
 * as text. Placeholders are put back by {@link blobNode}.
 */
export async function makeBlob(node: JsonNode, assets: LiveAssetStore): Promise<NotebookBlob> {
  // A notebook that already holds the placeholder text keeps everything inline, so it reads back as written.
  if (containsMarker(node)) return { json: compactJson(node), assets: [] }
  const slots: NotebookAssetSlot[] = []
  const sizes = new Map<JsonNode, number>()
  const pending: Promise<void>[] = []
  const replace = (slot: Promise<NotebookAssetSlot>): JsonNode => {
    const index = slots.length
    slots.push(null as unknown as NotebookAssetSlot)
    pending.push(slot.then((value) => { slots[index] = value }))
    return markerNode(index)
  }
  // Its value may hold placeholders of its own (parts already moved out), restored in turn.
  const asJson = (target: JsonNode) => replace(assets.put(new TextEncoder().encode(compactJson(target)), 'application/json').then((ref) => ({ hash: ref.hash, kind: 'json' as const })))

  // Rewrites `current`, children first; returns the node to keep in its place.
  const visit = (current: JsonNode, mime: string | null): JsonNode => {
    if (current.kind === 'string' && mime && BASE64_MIME.test(mime) && current.value.length >= BASE64_ASSET_THRESHOLD) {
      const base64 = readBase64(current.value)
      if (base64) {
        return replace(assets.put(base64.bytes, mime.toLowerCase()).then((ref) => ({
          hash: ref.hash, kind: 'base64' as const, mimeType: mime.toLowerCase(), trail: base64.trail, wrap: base64.wrap,
        })))
      }
    }
    if (current.kind === 'string' || current.kind === 'number' || current.kind === 'literal') {
      return sizeOf(current, sizes) < BLOB_ASSET_THRESHOLD ? current : asJson(current)
    }
    let next: JsonNode
    if (current.kind === 'array') {
      const items = current.items.map((item) => visit(item, mime))
      next = items.some((item, index) => item !== current.items[index]) ? { kind: 'array', items } : current
    } else {
      // Under `data` (outputs) and each attachment, keys are MIME types.
      const entries = current.entries.map((item) => ({ ...item, value: visit(item.value, /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(item.key) ? item.key : null) }))
      next = entries.some((item, index) => item.value !== current.entries[index]!.value) ? { kind: 'object', entries } : current
    }
    // Many small values (a long log split into lines, a large JSON output) still add up: they become one asset.
    return sizeOf(next, sizes) < BLOB_ASSET_THRESHOLD ? next : asJson(next)
  }

  const kept = visit(node, null)
  await Promise.all(pending)
  return { json: compactJson(kept), assets: slots }
}

/** Outputs or attachments as JSON nodes, their assets read back. */
export async function blobNode(blob: NotebookBlob, assets: LiveAssetStore, style: JsonStyle): Promise<JsonNode> {
  const root = parseJson(blob.json)
  if (!blob.assets.length) return root
  const values = await Promise.all(blob.assets.map(async (slot): Promise<JsonNode> => {
    const bytes = await assets.get(slot.hash)
    if (slot.kind === 'base64') {
      const value = layBase64(encodeBase64(bytes), slot.wrap, slot.trail)
      return { kind: 'string', raw: quote(value, style.ensureAscii), value }
    }
    return parseJson(new TextDecoder().decode(bytes))
  }))
  // `expanding` holds the parts being restored, so a damaged blob that refers to itself fails instead of looping.
  const restore = (node: JsonNode, expanding: ReadonlySet<number>): JsonNode => {
    if (node.kind === 'string' && node.value.startsWith(ASSET_MARKER)) {
      const index = Number(node.value.slice(ASSET_MARKER.length))
      const value = values[index]
      if (!value || expanding.has(index) || expanding.size > 64) throw new LiveFormatError('corrupt', 'A notebook output refers to a missing part')
      return restore(value, new Set([...expanding, index]))
    }
    if (node.kind === 'array') return { kind: 'array', items: node.items.map((item) => restore(item, expanding)) }
    if (node.kind === 'object') return { kind: 'object', entries: node.entries.map((item) => ({ ...item, value: restore(item.value, expanding) })) }
    return node
  }
  return restore(root, new Set())
}

/** Lines as Python's `str.splitlines(keepends=True)` makes them, which nbformat writes sources with. */
export function splitLines(text: string): string[] {
  const lines: string[] = []
  // oxlint-disable-next-line no-control-regex -- Python's line boundaries include control characters
  const pattern = /\r\n|[\n\r\u000b\u000c\u001c\u001d\u001e\u0085\u2028\u2029]/g
  let start = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    lines.push(text.slice(start, match.index + match[0].length))
    start = match.index + match[0].length
  }
  if (start < text.length) lines.push(text.slice(start))
  return lines
}

/** Text in a file's shape: one string, or a list of lines. */
export function textNode(text: string, shape: 'lines' | 'string', style: JsonStyle): JsonNode {
  if (shape === 'string') return stringNode(text, style)
  return { kind: 'array', items: splitLines(text).map((line) => stringNode(line, style)) }
}

export { jsonNode }
