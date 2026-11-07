import type { CellData, CellScalar, CsvDialect } from '../model/schema.js'

type FieldDialect = Pick<CsvDialect, 'delimiter' | 'quote'>

/** Numeric spellings CSV can read back exactly, without trimming typed whitespace. */
export function csvNumber(text: string): number | undefined {
  if (text !== text.trim() || !/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

/** Strictly one field: only doubled quotes escape a quote in the supported dialect. */
export function decodeCsvField(raw: string, dialect: FieldDialect): string | undefined {
  const { delimiter, quote } = dialect
  if (!raw.startsWith(quote)) {
    return raw.includes(delimiter) || raw.includes(quote) || /[\r\n]/.test(raw) ? undefined : raw
  }
  let text = ''
  for (let index = 1; index < raw.length; index++) {
    const char = raw[index]!
    if (char !== quote) text += char
    else if (index === raw.length - 1) return text
    else if (raw[index + 1] === quote) { text += quote; index++ }
    else return undefined
  }
  return undefined
}

/** A preserved field must be valid in the *output* dialect and still describe this value. */
export function preservedCsvField(data: CellData, value: CellScalar | { e: string }, dialect: FieldDialect): string | undefined {
  if (typeof data.raw !== 'string' || data.f !== undefined) return undefined
  const text = decodeCsvField(data.raw, dialect)
  if (text === undefined) return undefined
  const matches = typeof value === 'number' ? csvNumber(text) === value
    : value === null || value === undefined ? text === ''
    : typeof value === 'object' ? text === value.e
    : typeof value === 'boolean' ? text === (value ? 'TRUE' : 'FALSE')
    : text === value
  return matches ? data.raw : undefined
}

export function quoteCsvField(text: string, dialect: FieldDialect & Pick<CsvDialect, 'quoting'>): string {
  // A leading U+FEFF is cell content, not the file's encoding marker.
  const needs = text.startsWith('\uFEFF') || text.includes(dialect.delimiter) || text.includes(dialect.quote) || /[\r\n]/.test(text)
  if (!needs && dialect.quoting !== 'always') return text
  return dialect.quote + text.split(dialect.quote).join(dialect.quote + dialect.quote) + dialect.quote
}
