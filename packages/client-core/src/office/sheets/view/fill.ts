import { tokenize } from '../formula/tokenize.js'
import { dateToSerial, serialToParts, daysInMonth } from '../dates.js'
import { isDateFormat } from '../numfmt/index.js'
import type { CellValue } from '../values.js'

/**
 * The fill handle's series: what dragging a selection's corner continues. Like Excel:
 * one number repeats, two or more continue their linear trend; dates step by day (or by month or
 * year when the examples do); text ending in a number counts up; day and month names cycle;
 * anything else repeats. Formulas are copied with their references moved (handled by the caller).
 */

const LISTS = [
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ['Q1', 'Q2', 'Q3', 'Q4'],
]

export interface FillSource {
  value: CellValue
  /** The cell holds a formula (copied, not extended as a series). */
  formula: boolean
  numFmt: string
}

export type FillResult = { kind: 'copy'; from: number } | { kind: 'value'; value: CellValue }

function matchCase(word: string, model: string): string {
  if (model === model.toUpperCase()) return word.toUpperCase()
  if (model === model.toLowerCase()) return word.toLowerCase()
  return word
}

function listIndex(text: string): { list: string[]; index: number } | undefined {
  for (const list of LISTS) {
    const index = list.findIndex((entry) => entry.toLowerCase() === text.toLowerCase())
    if (index >= 0) return { list, index }
  }
  return undefined
}

/** Linear regression slope and intercept over x = 0..n-1. */
function trend(values: number[]): { slope: number; intercept: number } {
  const n = values.length
  if (n === 1) return { slope: 0, intercept: values[0]! }
  const meanX = (n - 1) / 2
  const meanY = values.reduce((sum, value) => sum + value, 0) / n
  let numerator = 0
  let denominator = 0
  values.forEach((value, x) => {
    numerator += (x - meanX) * (value - meanY)
    denominator += (x - meanX) ** 2
  })
  const slope = denominator ? numerator / denominator : 0
  return { slope, intercept: meanY - slope * meanX }
}

/** Rounds away floating-point noise from series arithmetic (0.1 + 0.2). */
function clean(n: number): number {
  return Number(n.toPrecision(15))
}

/**
 * The values for `count` cells continuing `sources` (in fill direction order). `step` > 0 fills
 * forward (down/right); < 0 fills backward (up/left), where position -1 is the cell just before
 * the first source.
 */
export function fillSeries(sources: FillSource[], count: number, backward = false, date1904 = false): FillResult[] {
  const results: FillResult[] = []
  if (!sources.length) return results
  const n = sources.length
  const at = (position: number): FillResult => {
    // `position` counts from the first source: n, n+1, … forward; -1, -2, … backward.
    const cycle = ((position % n) + n) % n
    return { kind: 'copy', from: cycle }
  }
  // A series needs every source to be the same kind.
  const numbers = sources.every((source) => !source.formula && typeof source.value === 'number')
  const dates = numbers && sources.every((source) => isDateFormat(source.numFmt))
  const textNumber = sources.every((source) => !source.formula && typeof source.value === 'string' && /\d+$/.test(source.value))
  const listed = sources.every((source) => !source.formula && typeof source.value === 'string') ? sources.map((source) => listIndex(source.value as string)) : []
  const positions = Array.from({ length: count }, (_, index) => (backward ? -1 - index : n + index))

  if (dates) {
    const serials = sources.map((source) => source.value as number)
    const parts = serials.map((serial) => serialToParts(serial, date1904))
    // Retain the original day even after a shorter month clips it (including leap years).
    const day = parts.reduce((max, part) => Math.max(max, part?.day ?? 0), 0)
    const fraction = serials[0]! - Math.floor(serials[0]!)
    if (n >= 2 && parts.every((part, i) => part && part.day === Math.min(day, daysInMonth(part.year, part.month, date1904)) && Math.abs(serials[i]! % 1 - fraction) < 1e-9)) {
      const months = parts.map((part) => part!.year * 12 + part!.month - 1)
      const step = months[1]! - months[0]!
      if (step && months.every((month, index) => index === 0 || month - months[index - 1]! === step)) {
        for (const position of positions) {
          const month = months[0]! + step * position
          const year = Math.floor(month / 12)
          const destinationMonth = month - year * 12 + 1
          const destinationDay = Math.min(day, daysInMonth(year, destinationMonth, date1904))
          results.push({ kind: 'value', value: dateToSerial(year, destinationMonth, destinationDay, date1904) + fraction })
        }
        return results
      }
    }
    const step = n === 1 ? 1 : trend(serials).slope
    const { intercept } = n === 1 ? { intercept: serials[0]! } : trend(serials)
    for (const position of positions) results.push({ kind: 'value', value: clean(intercept + step * position) })
    return results
  }
  if (numbers) {
    if (n === 1) return positions.map(at)
    const { slope, intercept } = trend(sources.map((source) => source.value as number))
    for (const position of positions) results.push({ kind: 'value', value: clean(intercept + slope * position) })
    return results
  }
  if (listed.length && listed.every((entry) => entry && entry.list === listed[0]!.list)) {
    const list = listed[0]!.list
    const step = n === 1 ? 1 : (listed[1]!.index - listed[0]!.index + list.length) % list.length || 1
    for (const position of positions) {
      const index = (((listed[0]!.index + step * position) % list.length) + list.length) % list.length
      results.push({ kind: 'value', value: matchCase(list[index]!, sources[0]!.value as string) })
    }
    return results
  }
  if (textNumber) {
    const parsed = sources.map((source) => /^(.*?)(\d+)$/.exec(source.value as string)!)
    const prefix = parsed[0]![1]!
    if (parsed.every((match) => match[1] === prefix)) {
      const values = parsed.map((match) => Number(match[2]))
      const width = parsed[0]![2]!.length
      const slope = n === 1 ? 1 : trend(values).slope
      const intercept = n === 1 ? values[0]! : trend(values).intercept
      for (const position of positions) {
        const number = Math.round(intercept + slope * position)
        const digits = String(Math.abs(number)).padStart(parsed[0]![2]!.startsWith('0') ? width : 1, '0')
        results.push({ kind: 'value', value: `${prefix}${number < 0 ? '-' : ''}${digits}` })
      }
      return results
    }
  }
  return positions.map(at)
}

/** Horizontal autofill advances qualified table columns; copy/paste and column ranges stay fixed. */
type FillTable = { name: string; displayName: string; columns: { name: string }[] }
type FillTableIndex = Map<string, { table: FillTable; columns: Map<string, number> }>

export function indexFillTables(tables: FillTable[]): FillTableIndex {
  const index: FillTableIndex = new Map()
  for (const table of tables) {
    const entry = { table, columns: new Map<string, number>() }
    table.columns.forEach((column, i) => { if (!entry.columns.has(column.name.toLowerCase())) entry.columns.set(column.name.toLowerCase(), i) })
    for (const name of [table.name, table.displayName]) if (!index.has(name.toLowerCase())) index.set(name.toLowerCase(), entry)
  }
  return index
}

export function fillStructuredFormula(formula: string, columns: number, tables: FillTable[] | FillTableIndex): string {
  if (!columns) return formula
  const tableIndex = Array.isArray(tables) ? indexFillTables(tables) : tables
  let out = '', last = 0
  for (const token of tokenize(formula)) {
    const ref = token.structured
    if (!ref?.table || ref.firstColumn === undefined || ref.lastColumn !== undefined) continue
    const entry = tableIndex.get(ref.table.toLowerCase())
    const table = entry?.table
    if (!table?.columns.length) continue
    const index = entry!.columns.get(ref.firstColumn.toLowerCase()) ?? -1
    if (index < 0) continue
    const next = ((index + columns) % table.columns.length + table.columns.length) % table.columns.length
    const name = table.columns[next]!.name.replace(/['[\]#@]/g, "'$&")
    const item = ref.items.length ? `[${[...ref.items.map((v) => `[${v}]`), `[${name}]`].join(',')}]` : `[${name}]`
    out += formula.slice(last, token.start) + ref.table + item
    last = token.end
  }
  return last ? out + formula.slice(last) : formula
}
