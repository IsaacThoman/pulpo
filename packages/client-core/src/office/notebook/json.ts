import { LiveFormatError } from '../live-format.js'

/**
 * JSON that remembers how it was written: object keys keep their order (JavaScript objects move
 * integer-like keys first), numbers keep their spelling (`1e-05`, `1.0`), and strings keep their
 * escapes (`é` or `é`). Notebooks are written back from it, so a notebook nobody edited is
 * written as it was read, and an edited one differs only where it was edited.
 *
 * Parsing is iterative, so hostile nesting cannot overflow the stack, and is bounded by
 * `MAX_JSON_DEPTH`.
 */

export type JsonNode =
  | { kind: 'object'; entries: JsonEntry[] }
  | { kind: 'array'; items: JsonNode[] }
  /** `raw` is the literal as written, quotes included; `value` is what it means. */
  | { kind: 'string'; raw: string; value: string }
  | { kind: 'number'; raw: string }
  | { kind: 'literal'; raw: 'true' | 'false' | 'null' }

export interface JsonEntry {
  /** The key's literal as written, quotes included. */
  raw: string
  key: string
  value: JsonNode
}

export const MAX_JSON_DEPTH = 256

/** How a file was laid out, so it can be written the same way. */
export interface JsonStyle {
  /** The indent of one level (`' '` for Jupyter), or null for everything on one line. */
  indent: string | null
  /** Line breaks between items when indented. */
  newline: '\n' | '\r\n'
  /** After a key's colon: `': '` (Python and JavaScript) or `':'`. */
  colon: string
  /** Between items, up to any line break: `','` when indented (Python 3), `', '` on one line (Python). */
  comma: string
  /** Whether non-ASCII characters are written as `\uXXXX` escapes (Python's `ensure_ascii`). */
  ensureAscii: boolean
  /** Whether keys of objects are sorted (Python's `sort_keys`, which Jupyter uses). */
  sortKeys: boolean
  /** What follows the closing brace: Jupyter writes one newline. */
  trailer: string
  /** Whether the file starts with a UTF-8 byte order mark. */
  bom: boolean
}

/** How Jupyter writes notebooks: `json.dumps(nb, sort_keys=True, indent=1, ensure_ascii=False)` and a newline. */
export const JUPYTER_STYLE: JsonStyle = {
  indent: ' ',
  newline: '\n',
  colon: ': ',
  comma: ',',
  ensureAscii: false,
  sortKeys: true,
  trailer: '\n',
  bom: false,
}

function corrupt(message: string): LiveFormatError {
  return new LiveFormatError('corrupt', message)
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r'])
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y

class Parser {
  index = 0
  constructor(readonly text: string) {}

  skip(): void {
    while (this.index < this.text.length && WHITESPACE.has(this.text[this.index]!)) this.index += 1
  }

  string(): { raw: string; value: string } {
    const { text } = this
    const start = this.index
    if (text[start] !== '"') throw corrupt(`Expected a string at ${start}`)
    let index = start + 1
    let value = ''
    let chunk = index
    for (;;) {
      if (index >= text.length) throw corrupt('A string never ends')
      const code = text.charCodeAt(index)
      if (code === 0x22) break
      if (code < 0x20) throw corrupt(`A control character in a string at ${index}`)
      if (code !== 0x5c) {
        index += 1
        continue
      }
      value += text.slice(chunk, index)
      const escape = text[index + 1]
      switch (escape) {
        case '"': value += '"'; break
        case '\\': value += '\\'; break
        case '/': value += '/'; break
        case 'b': value += '\b'; break
        case 'f': value += '\f'; break
        case 'n': value += '\n'; break
        case 'r': value += '\r'; break
        case 't': value += '\t'; break
        case 'u': {
          const hex = text.slice(index + 2, index + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw corrupt(`A bad escape at ${index}`)
          value += String.fromCharCode(Number.parseInt(hex, 16))
          index += 4
          break
        }
        default: throw corrupt(`A bad escape at ${index}`)
      }
      index += 2
      chunk = index
    }
    value += text.slice(chunk, index)
    this.index = index + 1
    return { raw: text.slice(start, index + 1), value }
  }

  /** A scalar at the cursor, or null when a container starts there. */
  scalar(): JsonNode | null {
    const { text } = this
    const character = text[this.index]
    if (character === '"') {
      const { raw, value } = this.string()
      return { kind: 'string', raw, value }
    }
    if (character === '{' || character === '[') return null
    for (const raw of ['true', 'false', 'null'] as const) {
      if (text.startsWith(raw, this.index)) {
        this.index += raw.length
        return { kind: 'literal', raw }
      }
    }
    NUMBER.lastIndex = this.index
    const match = NUMBER.exec(text)
    if (!match) throw corrupt(`Unexpected ${character === undefined ? 'end of file' : `"${character}"`} at ${this.index}`)
    this.index += match[0].length
    return { kind: 'number', raw: match[0] }
  }
}

type Frame =
  | { node: Extract<JsonNode, { kind: 'object' }>; pendingKey: { raw: string; key: string } | null }
  | { node: Extract<JsonNode, { kind: 'array' }> }

/** Parses JSON text into nodes that keep its spelling. Throws `LiveFormatError('corrupt')` for invalid JSON. */
export function parseJson(text: string): JsonNode {
  return parseJsonDocument(text).root
}

/** The first separators a document uses, as written: what follows a key, and what goes between items. */
export interface JsonSeparators {
  colon: string | null
  comma: string | null
}

export function parseJsonDocument(text: string): { root: JsonNode; separators: JsonSeparators } {
  const separators: JsonSeparators = { colon: null, comma: null }
  const parser = new Parser(text)
  const stack: Frame[] = []
  let root: JsonNode | null = null

  const open = (character: string): Frame => {
    if (stack.length >= MAX_JSON_DEPTH) throw corrupt('The JSON is nested too deeply')
    parser.index += 1
    return character === '{'
      ? { node: { kind: 'object', entries: [] }, pendingKey: null }
      : { node: { kind: 'array', items: [] } }
  }

  const attach = (node: JsonNode) => {
    const parent = stack[stack.length - 1]
    if (!parent) {
      root = node
      return
    }
    if (parent.node.kind === 'array') parent.node.items.push(node)
    else {
      const frame = parent as Extract<Frame, { pendingKey: unknown }>
      frame.node.entries.push({ ...frame.pendingKey!, value: node })
      frame.pendingKey = null
    }
  }

  // Reads one value; containers are pushed and filled by the loop below.
  const value = () => {
    parser.skip()
    const scalar = parser.scalar()
    if (scalar) attach(scalar)
    else stack.push(open(text[parser.index]!))
  }

  value()
  while (stack.length) {
    const frame = stack[stack.length - 1]!
    const separatorStart = parser.index
    parser.skip()
    const character = text[parser.index]
    const empty = frame.node.kind === 'array' ? frame.node.items.length === 0 : frame.node.entries.length === 0
    const close = frame.node.kind === 'array' ? ']' : '}'
    if (character === close) {
      parser.index += 1
      stack.pop()
      attach(frame.node)
      continue
    }
    if (!empty) {
      if (character !== ',') throw corrupt(`Expected "," or "${close}" at ${parser.index}`)
      parser.index += 1
      parser.skip()
      separators.comma ??= text.slice(separatorStart, parser.index)
    }
    if (frame.node.kind === 'object') {
      const key = parser.string()
      const colonStart = parser.index
      parser.skip()
      if (text[parser.index] !== ':') throw corrupt(`Expected ":" at ${parser.index}`)
      parser.index += 1
      parser.skip()
      separators.colon ??= text.slice(colonStart, parser.index)
      ;(frame as Extract<Frame, { pendingKey: unknown }>).pendingKey = { raw: key.raw, key: key.value }
    }
    value()
  }
  parser.skip()
  if (parser.index !== text.length) throw corrupt(`Unexpected text after the JSON at ${parser.index}`)
  return { root: root!, separators }
}

/** What a node means, as JSON.parse would give it. */
export function jsonValue(node: JsonNode): unknown {
  switch (node.kind) {
    case 'string': return node.value
    case 'number': return Number(node.raw)
    case 'literal': return node.raw === 'null' ? null : node.raw === 'true'
    case 'array': return node.items.map(jsonValue)
    case 'object': {
      const object: Record<string, unknown> = {}
      for (const entry of node.entries) {
        Object.defineProperty(object, entry.key, { value: jsonValue(entry.value), enumerable: true, configurable: true, writable: true })
      }
      return object
    }
  }
}

/** Nodes for a plain value, e.g. one made by an editor. Keys keep the object's own order. */
export function jsonNode(value: unknown, style: Pick<JsonStyle, 'ensureAscii'> = JUPYTER_STYLE): JsonNode {
  if (value === null || value === undefined) return { kind: 'literal', raw: 'null' }
  if (typeof value === 'boolean') return { kind: 'literal', raw: value ? 'true' : 'false' }
  if (typeof value === 'number') return Number.isFinite(value) ? { kind: 'number', raw: formatNumber(value) } : { kind: 'literal', raw: 'null' }
  if (typeof value === 'string') return stringNode(value, style)
  if (Array.isArray(value)) return { kind: 'array', items: value.map((item) => jsonNode(item, style)) }
  if (typeof value === 'object') {
    return {
      kind: 'object',
      entries: Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => ({ raw: quote(key, style.ensureAscii), key, value: jsonNode(item, style) })),
    }
  }
  return { kind: 'literal', raw: 'null' }
}

/** Numbers as Python writes them where JavaScript differs: integers as integers, `1e-05` exponents. */
function formatNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e16) return String(value)
  const text = String(value)
  // Python pads exponents to two digits and always signs them.
  return text.replace(/e([+-])(\d)$/, 'e$10$2').replace(/e(\d)/, 'e+$1')
}

export function stringNode(value: string, style: Pick<JsonStyle, 'ensureAscii'> = JUPYTER_STYLE): Extract<JsonNode, { kind: 'string' }> {
  return { kind: 'string', raw: quote(value, style.ensureAscii), value }
}

const SHORT_ESCAPES: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' }

/** A JSON string literal as Python's `json.dumps` writes it, with or without `ensure_ascii`. */
export function quote(value: string, ensureAscii: boolean): string {
  // oxlint-disable-next-line no-control-regex -- JSON escapes control characters
  const pattern = ensureAscii ? /["\\\u0000-\u001f\u007f-\uffff]/g : /["\\\u0000-\u001f]/g
  return `"${value.replace(pattern, (character) => SHORT_ESCAPES[character] ?? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`
}

function sortedEntries(entries: JsonEntry[]): JsonEntry[] {
  // Python sorts keys by code point; JavaScript's default sort compares UTF-16 units, which only
  // differs past the BMP, and is close enough for notebooks.
  return [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/**
 * Writes nodes as JSON text in `style`, starting at `depth` levels of indent (for a value placed
 * inside a larger document). Iterative, like the parser.
 */
export function writeJson(node: JsonNode, style: JsonStyle, depth = 0): string {
  const parts: string[] = []
  const indented = style.indent !== null
  const breakAt = (level: number) => (indented ? style.newline + style.indent!.repeat(level) : '')
  const itemSeparator = style.comma
  type Task = { node: JsonNode; level: number } | { text: string }
  const tasks: Task[] = [{ node, level: depth }]
  while (tasks.length) {
    const task = tasks.pop()!
    if ('text' in task) {
      parts.push(task.text)
      continue
    }
    const { node: current, level } = task
    switch (current.kind) {
      case 'string':
      case 'number':
      case 'literal':
        parts.push(current.raw)
        break
      case 'array': {
        if (!current.items.length) {
          parts.push('[]')
          break
        }
        parts.push('[')
        const next: Task[] = []
        current.items.forEach((item, index) => {
          next.push({ text: (index ? itemSeparator : '') + breakAt(level + 1) })
          next.push({ node: item, level: level + 1 })
        })
        next.push({ text: `${breakAt(level)}]` })
        for (let index = next.length - 1; index >= 0; index -= 1) tasks.push(next[index]!)
        break
      }
      case 'object': {
        if (!current.entries.length) {
          parts.push('{}')
          break
        }
        parts.push('{')
        const entries = style.sortKeys ? sortedEntries(current.entries) : current.entries
        const next: Task[] = []
        entries.forEach((entry, index) => {
          next.push({ text: `${index ? itemSeparator : ''}${breakAt(level + 1)}${entry.raw}${style.colon}` })
          next.push({ node: entry.value, level: level + 1 })
        })
        next.push({ text: `${breakAt(level)}}` })
        for (let index = next.length - 1; index >= 0; index -= 1) tasks.push(next[index]!)
        break
      }
    }
  }
  return parts.join('')
}

/** One line of compact JSON that keeps every spelling: how opaque values are kept in the Y.Doc. */
export const COMPACT_STYLE: JsonStyle = { ...JUPYTER_STYLE, indent: null, colon: ':', comma: ',', sortKeys: false, trailer: '' }

export function compactJson(node: JsonNode): string {
  return writeJson(node, COMPACT_STYLE)
}

function isSorted(entries: JsonEntry[]): boolean {
  for (let index = 1; index < entries.length; index += 1) if (entries[index - 1]!.key > entries[index]!.key) return false
  return true
}

/** Whether every object in the tree has its keys in sorted order. */
function allSorted(root: JsonNode): boolean {
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()!
    if (node.kind === 'object') {
      if (!isSorted(node.entries)) return false
      for (const entry of node.entries) stack.push(entry.value)
    } else if (node.kind === 'array') for (const item of node.items) stack.push(item)
  }
  return true
}

/**
 * How `text` (parsed into `root` with `separators`) is laid out. Guesses are checked by writing the
 * file back (see the codec), so a wrong guess only costs keeping the original bytes.
 */
export function detectStyle(text: string, root: JsonNode, separators: JsonSeparators, bom: boolean): JsonStyle {
  const trailer = text.slice(text.trimEnd().length)
  // An indented document breaks the line after its opening bracket; `indent=0` breaks without indenting.
  const firstBreak = /^[{[][ \t]*(\r?\n)([ \t]*)/.exec(text)
  const indent = firstBreak ? firstBreak[2]! : null
  const newline = firstBreak?.[1] === '\r\n' ? '\r\n' : '\n'
  // Separators up to any line break: Python 2 wrote `, ` before each break, Python 3 writes `,`.
  const beforeBreak = (separator: string | null, fallback: string) => separator === null ? fallback : separator.replace(/\r?\n[\s\S]*$/, '')
  // Non-ASCII written as is means no `ensure_ascii`; escapes of it (and none as is) mean it.
  const rawNonAscii = /[\u0080-\uffff]/.test(text)
  const escapedNonAscii = /\\u(?:00[89a-fA-F][0-9a-fA-F]|0[1-9a-fA-F][0-9a-fA-F]{2}|[1-9a-fA-F][0-9a-fA-F]{3})/.test(text)
  return {
    indent,
    newline,
    colon: beforeBreak(separators.colon, ': '),
    comma: beforeBreak(separators.comma, indent === null ? ', ' : ','),
    ensureAscii: !rawNonAscii && escapedNonAscii,
    sortKeys: allSorted(root),
    trailer,
    bom,
  }
}

/** The text of a whole document in `style`, trailer included. */
export function writeDocument(node: JsonNode, style: JsonStyle): string {
  return writeJson(node, style) + style.trailer
}
