import type * as Y from 'yjs'
import { LiveFormatError } from '../../live-format.js'
import { MAX_COLS, MAX_ROWS } from '../address.js'
import type { CellData, CellScalar, CsvDialect } from '../model/schema.js'
import { WorkbookModel, type SheetModel } from '../model/workbook.js'
import { numberText, type ValueSource } from './write-worksheet.js'

/**
 * CSV and TSV: one sheet of values. A file is written back the way it came (delimiter, quoting,
 * encoding and byte order mark, line endings, trailing newline), and fields nobody edited keep
 * their exact text, so opening and saving a CSV changes nothing.
 */

export const CSV_LIMITS = { maxBytes: 200 * 1024 * 1024, maxCells: 2_000_000, maxFieldLength: 32_767 * 4 }

const NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** Windows-1252's 0x80–0x9F block, for encoding back. */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ'

export function decodeText(bytes: Uint8Array): { text: string; encoding: CsvDialect['encoding']; bom: boolean } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8', bom: true }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le', bom: true }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be', bom: true }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8', bom: false }
  } catch {
    // Not UTF-8: most likely a legacy Windows export.
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252', bom: false }
  }
}

export function encodeText(text: string, dialect: Pick<CsvDialect, 'encoding' | 'bom'>): Uint8Array {
  switch (dialect.encoding) {
    case 'utf-16le':
    case 'utf-16be': {
      const out = new Uint8Array(text.length * 2 + 2)
      const little = dialect.encoding === 'utf-16le'
      let offset = 0
      const put = (unit: number) => {
        out[offset++] = little ? unit & 0xff : unit >> 8
        out[offset++] = little ? unit >> 8 : unit & 0xff
      }
      put(0xfeff)
      for (let index = 0; index < text.length; index++) put(text.charCodeAt(index))
      return dialect.bom ? out : out.subarray(2)
    }
    case 'windows-1252': {
      const out = new Uint8Array(text.length)
      for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index)
        const high = CP1252_HIGH.indexOf(text[index]!)
        if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out[index] = code
        else if (high >= 0) out[index] = 0x80 + high
        // Text that doesn't fit the legacy encoding any more: switch to UTF-8 with a BOM rather than lose it.
        else return encodeText(text, { encoding: 'utf-8', bom: true })
      }
      return out
    }
    default: {
      const body = new TextEncoder().encode(text)
      if (!dialect.bom) return body
      const out = new Uint8Array(body.length + 3)
      out.set([0xef, 0xbb, 0xbf])
      out.set(body, 3)
      return out
    }
  }
}

interface ParsedCsv {
  /** Each field's value, whether it was quoted, and its exact text in the file. */
  rows: { fields: string[]; quoted: boolean[]; sources: string[]; ending: string }[]
  lineEnding: CsvDialect['lineEnding']
  trailingNewline: boolean
}

/** Parses RFC 4180-style text (quotes doubled inside quoted fields; newlines allowed in them). */
export function parseCsv(text: string, delimiter: string, quote = '"'): ParsedCsv {
  const rows: ParsedCsv['rows'] = []
  let fields: string[] = []
  let quoted: boolean[] = []
  let sources: string[] = []
  let field = ''
  let isQuoted = false
  let fieldStart = 0
  let lineEnding: CsvDialect['lineEnding'] | undefined
  const endings = new Map<string, number>()
  let index = 0
  let cells = 0
  const endField = () => {
    if (field.length > CSV_LIMITS.maxFieldLength) throw new LiveFormatError('too_large', 'A field in this file is too long')
    fields.push(field)
    quoted.push(isQuoted)
    sources.push(text.slice(fieldStart, index))
    field = ''
    isQuoted = false
    if (++cells > CSV_LIMITS.maxCells) throw new LiveFormatError('too_large', 'This file has too many cells to edit')
  }
  const endRow = (ending = '') => {
    endField()
    rows.push({ fields, quoted, sources, ending })
    fields = []
    quoted = []
    sources = []
  }
  while (index < text.length) {
    const char = text[index]!
    if (char === quote && field === '' && !isQuoted) {
      // A quoted field: read to the closing quote.
      isQuoted = true
      index++
      while (index < text.length) {
        const inner = text[index]!
        if (inner === quote) {
          if (text[index + 1] === quote) {
            field += quote
            index += 2
            continue
          }
          index++
          break
        }
        field += inner
        index++
      }
      continue
    }
    if (char === delimiter) {
      endField()
      index++
      fieldStart = index
      continue
    }
    if (char === '\r' || char === '\n') {
      const ending = char === '\r' && text[index + 1] === '\n' ? '\r\n' : char
      endings.set(ending, (endings.get(ending) ?? 0) + 1)
      endRow(ending)
      index += ending.length
      fieldStart = index
      continue
    }
    field += char
    index++
  }
  const trailingNewline = text.length > 0 && (text.endsWith('\n') || text.endsWith('\r'))
  if (!trailingNewline && (text.length > 0 || fields.length)) endRow()
  for (const [ending, count] of endings) if (!lineEnding || count > endings.get(lineEnding)!) lineEnding = ending as CsvDialect['lineEnding']
  return { rows, lineEnding: lineEnding ?? '\r\n', trailingNewline }
}

/** Picks the delimiter that splits the first lines most consistently. */
export function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 64 * 1024)
  let best = ','
  let bestScore = -1
  for (const candidate of [',', ';', '\t', '|']) {
    const counts = parseCsv(sample.slice(0, sample.lastIndexOf('\n') > 0 ? sample.lastIndexOf('\n') : sample.length), candidate)
      .rows.slice(0, 50)
      .map((row) => row.fields.length)
    if (!counts.length) continue
    const first = counts[0]!
    const consistent = counts.filter((count) => count === first).length / counts.length
    const score = first > 1 ? consistent * 1000 + first : 0
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/** Reads CSV/TSV bytes into an empty Y.Doc as one sheet. */
export function readCsv(doc: Y.Doc, bytes: Uint8Array, format: 'csv' | 'tsv'): void {
  if (bytes.byteLength > CSV_LIMITS.maxBytes) throw new LiveFormatError('too_large', 'This file is too large to edit')
  const { text, encoding, bom } = decodeText(bytes)
  const delimiter = format === 'tsv' ? '\t' : sniffDelimiter(text)
  const parsed = parseCsv(text, delimiter)
  if (parsed.rows.length > MAX_ROWS) throw new LiveFormatError('too_large', 'This file has more rows than a sheet can hold')
  const allQuoted = parsed.rows.length > 0 && parsed.rows.every((row) => row.fields.every((field, index) => row.quoted[index] || (field === '' && row.fields.length === 1)))
  const dialect: CsvDialect = {
    delimiter,
    quote: '"',
    lineEnding: parsed.lineEnding,
    encoding,
    bom,
    trailingNewline: parsed.trailingNewline,
    quoting: allQuoted && parsed.rows.some((row) => row.quoted.some(Boolean)) ? 'always' : 'minimal',
  }
  const model = WorkbookModel.initialize(doc, { format, csv: dialect })
  doc.transact(() => {
    const sheet = model.addSheet('Sheet1')
    model.meta.set('activeSheet', sheet.id)
    let width = 0
    for (const row of parsed.rows) width = Math.max(width, row.fields.length)
    if (width > MAX_COLS) throw new LiveFormatError('too_large', 'This file has more columns than a sheet can hold')
    sheet.rows.ensure(parsed.rows.length)
    sheet.cols.ensure(width)
    // The file's width, trailing empty fields included, by column id so that columns inserted or
    // deleted later move it. Rows of another width (ragged rows, blank lines) and rows ending in
    // another line break than the file's keep their own, the same way.
    if (width > 0) sheet.raw.set('csvLastCol', sheet.cols.idAt(width - 1))
    // Likewise its last line, which may hold nothing but delimiters.
    if (parsed.rows.length) sheet.raw.set('csvLastRow', sheet.rows.idAt(parsed.rows.length - 1))
    parsed.rows.forEach((row, rowIndex) => {
      const rowId = sheet.rows.idAt(rowIndex)
      const keep: { last?: string; ending?: string } = {}
      if (row.fields.length !== width) keep.last = sheet.cols.idAt(row.fields.length - 1)
      if (row.ending && row.ending !== dialect.lineEnding) keep.ending = row.ending
      if (keep.last !== undefined || keep.ending !== undefined) sheet.rowMeta.set(`${rowId}|keep`, keep)
      row.fields.forEach((field, colIndex) => {
        // Empty fields keep their source too, independently of the policy for newly typed cells.
        sheet.cells.set(`${rowId}:${sheet.cols.idAt(colIndex)}`, fieldData(field, row.quoted[colIndex]!, row.sources[colIndex]!))
      })
    })
  })
}

/** A field's cell: its value, and its exact text when writing the value back would differ. */
function fieldData(field: string, quoted: boolean, source: string): CellData {
  if (field === '' && !quoted) return { raw: source }
  if (NUMBER.test(field)) {
    const n = Number(field)
    if (Number.isFinite(n)) return String(n) === field && !quoted ? { v: n } : { v: n, raw: source }
  }
  return quoted ? { v: field, raw: source } : { v: field }
}

function formatField(value: CellScalar | { e: string }): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return value.e
  if (typeof value === 'number') return numberText(value).replace('E', 'E+').replace('E+-', 'E-')
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return value
}

function quoteField(text: string, dialect: CsvDialect): string {
  const needs = text.includes(dialect.delimiter) || text.includes(dialect.quote) || text.includes('\n') || text.includes('\r')
  if (!needs && dialect.quoting !== 'always') return text
  return dialect.quote + text.split(dialect.quote).join(dialect.quote + dialect.quote) + dialect.quote
}

/** Writes the active or first visible sheet as CSV/TSV, in the dialect it was read with. */
export function writeCsv(doc: Y.Doc, format: 'csv' | 'tsv', values?: ValueSource): Uint8Array {
  const model = new WorkbookModel(doc)
  const dialect: CsvDialect = {
    delimiter: format === 'tsv' ? '\t' : ',',
    quote: '"',
    lineEnding: '\r\n',
    encoding: 'utf-8',
    bom: false,
    trailingNewline: true,
    quoting: 'minimal',
    ...model.metaValue('csv'),
  }
  // The extension decides between tabs and the delimiter the file was read with.
  if (format === 'tsv') dialect.delimiter = '\t'
  else if (model.metaValue('format') !== format && dialect.delimiter === '\t') dialect.delimiter = ','
  const active = model.metaValue('activeSheet')
  const sheet = (active ? model.sheet(active) : undefined) ?? model.sheets().find((entry) => entry.state === 'visible') ?? model.sheets()[0]
  const lines = sheet ? sheetLines(sheet, dialect, values) : []
  const text = lines.join('')
  return encodeText(text, dialect)
}

function sheetLines(sheet: SheetModel, dialect: CsvDialect, values?: ValueSource): string[] {
  const used = sheet.usedRange()
  let lastRow = used ? used.bottom : -1
  // Rows that were blank lines or ragged keep their shape, and the file keeps its last line.
  const fileLastRow = sheet.raw.get('csvLastRow') as string | undefined
  if (fileLastRow !== undefined) lastRow = Math.max(lastRow, sheet.rows.indexOf(fileLastRow))
  for (const key of sheet.rowMeta.keys()) {
    const index = sheet.rows.indexOf(key.slice(0, key.lastIndexOf('|')))
    if (index > lastRow) lastRow = index
  }
  // Rows are as wide as the file was (trailing empty fields included) or as its content now is:
  // a value typed into a new column widens every row, as Excel writes it. Rows that had their own
  // width keep it.
  const fileLast = sheet.raw.get('csvLastCol') as string | undefined
  const width = Math.max(used ? used.right + 1 : 0, fileLast !== undefined ? sheet.cols.indexOf(fileLast) + 1 : 0)
  const lines: string[] = []
  for (let row = 0; row <= lastRow; row++) {
    const keep = sheet.rowProp(row, 'keep') as { last?: string; ending?: string } | undefined
    const declared = keep?.last !== undefined ? sheet.cols.indexOf(keep.last) + 1 : width
    const fields: string[] = []
    let last = -1
    for (let col = 0; col < Math.max(width, declared); col++) {
      const data = sheet.cell(row, col)
      if (!data) {
        fields.push(dialect.quoting === 'always' ? dialect.quote + dialect.quote : '')
        continue
      }
      last = col
      if (data.raw !== undefined) {
        fields.push(data.raw)
        continue
      }
      const value = data.f !== undefined ? (values?.(sheet, row, col, data) ?? (data.t === 'e' ? { e: String(data.v) } : (data.v ?? null))) : data.t === 'e' ? { e: String(data.v) } : (data.v ?? null)
      fields.push(quoteField(formatField(value), dialect))
    }
    const ending = row < lastRow ? (keep?.ending || dialect.lineEnding) : dialect.trailingNewline ? (keep?.ending || dialect.lineEnding) : ''
    lines.push(fields.slice(0, Math.max(declared, last + 1)).join(dialect.delimiter) + ending)
  }
  return lines
}
