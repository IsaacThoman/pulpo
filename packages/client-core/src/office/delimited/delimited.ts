/**
 * CSV and TSV as RFC 4180 describes them, plus what real files do: a byte order mark, CRLF or bare
 * CR line ends, semicolons in locales with decimal commas, and stray quotes inside unquoted cells.
 *
 * A table is indexed once (where each row starts) and rows are parsed when asked for, so a grid can
 * scroll 100k+ rows while holding only the text and one number per row. Runs in Node and React
 * Native as well as browsers; nothing here touches the DOM.
 */

export type Delimiter = ',' | ';' | '\t' | '|'

export const DELIMITER_CANDIDATES: readonly Delimiter[] = [',', ';', '\t', '|']

/** Rows past this are not indexed; the grid says the file was cut. */
export const MAX_DELIMITED_ROWS = 2_000_000
/** Cells past this column are dropped, so one runaway row cannot make every row wide. */
export const MAX_DELIMITED_COLUMNS = 1_000

const QUOTE = 34
const LF = 10
const CR = 13

/** Offsets of one row in the text: from `start` up to (not including) its line break. */
interface RowSpan {
  start: number
  end: number
  /** Where the next row starts. */
  next: number
  fields: number
}

/**
 * Scans one row starting at `start`. Quotes open a quoted field only at the start of a field, as
 * Excel reads them; elsewhere they are ordinary characters. A quoted field runs to its closing
 * quote, across delimiters and line breaks; an unclosed one runs to the end of the text.
 */
function scanRow(text: string, start: number, delimiter: number): RowSpan {
  const length = text.length
  let index = start
  let fields = 1
  let fieldStart = true
  while (index < length) {
    const code = text.charCodeAt(index)
    if (fieldStart && code === QUOTE) {
      index += 1
      while (index < length) {
        if (text.charCodeAt(index) === QUOTE) {
          if (text.charCodeAt(index + 1) === QUOTE) {
            index += 2
            continue
          }
          index += 1
          break
        }
        index += 1
      }
      fieldStart = false
      continue
    }
    if (code === delimiter) {
      fields += 1
      fieldStart = true
      index += 1
      continue
    }
    if (code === LF || code === CR) {
      const next = code === CR && text.charCodeAt(index + 1) === LF ? index + 2 : index + 1
      return { start, end: index, next, fields }
    }
    fieldStart = false
    index += 1
  }
  return { start, end: length, next: length, fields }
}

/** Splits the row in `text[start, end)` into cells, unquoting quoted ones. */
export function parseDelimitedRow(text: string, start: number, end: number, delimiter: string, maxColumns = MAX_DELIMITED_COLUMNS): string[] {
  const separator = delimiter.charCodeAt(0)
  const cells: string[] = []
  let index = start
  while (index <= end) {
    let cell = ''
    if (text.charCodeAt(index) === QUOTE && index < end) {
      index += 1
      let chunkStart = index
      while (index < end) {
        if (text.charCodeAt(index) === QUOTE) {
          cell += text.slice(chunkStart, index)
          if (text.charCodeAt(index + 1) === QUOTE && index + 1 < end) {
            cell += '"'
            index += 2
            chunkStart = index
            continue
          }
          index += 1
          chunkStart = -1
          break
        }
        index += 1
      }
      if (chunkStart >= 0) cell += text.slice(chunkStart, index)
      // Anything after the closing quote and before the delimiter is kept, as spreadsheets do.
      const rest = index
      while (index < end && text.charCodeAt(index) !== separator) index += 1
      cell += text.slice(rest, index)
    } else {
      const cellStart = index
      while (index < end && text.charCodeAt(index) !== separator) index += 1
      cell = text.slice(cellStart, index)
    }
    if (cells.length < maxColumns) cells.push(cell)
    index += 1
  }
  return cells
}

/**
 * Guesses the delimiter from the first rows: the candidate that splits them into the same number
 * of columns most often wins, and the declared one (comma for `.csv`, tab for `.tsv`) wins ties.
 */
export function sniffDelimiter(text: string, declared: Delimiter = ',', sampleRows = 50): Delimiter {
  const sample = text.slice(0, 64 * 1024)
  let best = declared
  let bestScore = -1
  for (const candidate of [declared, ...DELIMITER_CANDIDATES.filter((value) => value !== declared)]) {
    const code = candidate.charCodeAt(0)
    const counts = new Map<number, number>()
    let rows = 0
    let index = sample.charCodeAt(0) === 0xfeff ? 1 : 0
    while (index < sample.length && rows < sampleRows) {
      const span = scanRow(sample, index, code)
      index = span.next
      if (span.end === span.start) continue
      // A row cut by the end of the sample would skew the count.
      if (span.end === sample.length && sample.length < text.length) break
      rows += 1
      counts.set(span.fields, (counts.get(span.fields) ?? 0) + 1)
    }
    let score = 0
    for (const [fields, count] of counts) if (fields > 1) score = Math.max(score, count * Math.min(fields, 8))
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

export interface DelimitedTable {
  readonly delimiter: Delimiter
  /** Rows in the file, header included, blank lines left out. */
  readonly rowCount: number
  /** The widest row's cell count, capped at `MAX_DELIMITED_COLUMNS`. */
  readonly columnCount: number
  /** The widest row before the cap, so views can say columns were left out. */
  readonly sourceColumnCount: number
  /** Whether rows past `MAX_DELIMITED_ROWS` were left out. */
  readonly truncated: boolean
  /** One row's cells, unquoted; rows narrower than the table are not padded. */
  row(index: number): string[]
  /** One row as it is written in the file. */
  rowText(index: number): string
  /**
   * Rows with a cell containing `query`, case-insensitively, in order. Searches the text rather
   * than parsing every row, so it stays fast for large files.
   */
  findRows(query: string, limit?: number): number[]
}

export interface DelimitedOptions {
  /** The delimiter to use; sniffed from the first rows (preferring `declared`) when absent. */
  delimiter?: Delimiter
  declared?: Delimiter
  maxRows?: number
  maxColumns?: number
}

/** Indexes delimited text for random access by row. */
export function indexDelimited(source: string, options: DelimitedOptions = {}): DelimitedTable {
  // A leading byte order mark would otherwise become part of the first header.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  const delimiter = options.delimiter ?? sniffDelimiter(text, options.declared ?? ',')
  const maxRows = options.maxRows ?? MAX_DELIMITED_ROWS
  const maxColumns = options.maxColumns ?? MAX_DELIMITED_COLUMNS
  const code = delimiter.charCodeAt(0)

  let starts = new Uint32Array(1024)
  let ends = new Uint32Array(1024)
  let rowCount = 0
  let widest = 0
  let index = 0
  let truncated = false
  while (index < text.length) {
    const span = scanRow(text, index, code)
    index = span.next
    // Blank lines carry no data, so they are skipped rather than shown as empty rows.
    if (span.end === span.start) continue
    if (rowCount >= maxRows) {
      truncated = true
      break
    }
    if (rowCount === starts.length) {
      const grownStarts = new Uint32Array(starts.length * 2)
      grownStarts.set(starts)
      starts = grownStarts
      const grownEnds = new Uint32Array(ends.length * 2)
      grownEnds.set(ends)
      ends = grownEnds
    }
    starts[rowCount] = span.start
    ends[rowCount] = span.end
    rowCount += 1
    if (span.fields > widest) widest = span.fields
  }

  const rowAt = (row: number): { start: number; end: number } => {
    if (!Number.isInteger(row) || row < 0 || row >= rowCount) throw new RangeError(`Row ${row} is outside the table`)
    return { start: starts[row]!, end: ends[row]! }
  }

  const rowOfOffset = (offset: number): number => {
    let low = 0
    let high = rowCount - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (starts[middle]! <= offset) low = middle
      else high = middle - 1
    }
    return low
  }

  const parse = (row: number): string[] => {
    const { start, end } = rowAt(row)
    return parseDelimitedRow(text, start, end, delimiter, maxColumns)
  }

  return {
    delimiter,
    rowCount,
    columnCount: Math.min(widest, maxColumns),
    sourceColumnCount: widest,
    truncated,
    row: parse,
    rowText(row) {
      const { start, end } = rowAt(row)
      return text.slice(start, end)
    },
    findRows(query, limit = Number.POSITIVE_INFINITY) {
      const needle = query.toLowerCase()
      if (!needle || rowCount === 0) return []
      const matches = (row: number) => parse(row).some((cell) => cell.toLowerCase().includes(needle))
      const rows: number[] = []
      // Text without quotes, delimiters, or line breaks appears in the file exactly as in its cell,
      // so the raw text finds every candidate; anything else is checked cell by cell.
      if (needle.includes('"') || needle.includes(delimiter) || /[\r\n]/.test(needle)) {
        for (let row = 0; row < rowCount && rows.length < limit; row += 1) if (matches(row)) rows.push(row)
        return rows
      }
      const haystack = text.toLowerCase()
      // Lower-casing can change length for a few characters (İ); then offsets no longer line up.
      if (haystack.length !== text.length) {
        for (let row = 0; row < rowCount && rows.length < limit; row += 1) if (matches(row)) rows.push(row)
        return rows
      }
      let from = 0
      while (rows.length < limit) {
        const found = haystack.indexOf(needle, from)
        if (found < 0) break
        const row = rowOfOffset(found)
        if (found >= starts[row]! && found + needle.length <= ends[row]! && rows[rows.length - 1] !== row) rows.push(row)
        // Continue after this row: one match per row is enough.
        from = Math.max(found + 1, ends[row]!)
      }
      return rows
    },
  }
}

/** Spreadsheet column letters: 0 is A, 25 is Z, 26 is AA. */
export function columnLabel(index: number): string {
  let label = ''
  let value = index + 1
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}
