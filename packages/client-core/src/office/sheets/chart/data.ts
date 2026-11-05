import { FormulaError, type Scalar } from '../formula/types.js'
import { MAX_CHART_POINTS, type ChartGroup, type ChartSeries, type ChartValue, type DataSource } from './model.js'

/**
 * Turns series references into plain arrays: live cell values when the caller can resolve the
 * reference, otherwise the cached points from the file.
 */

export type RangeResolver = (formula: string) => Scalar[][] | undefined

export interface ResolvedSource {
  /** One entry per point: numbers for numeric data, strings for text, null for blanks/errors. */
  values: ChartValue[]
  /** Category levels when the reference spans several rows/columns (innermost first). */
  levels?: (string | null)[][]
  formatCode?: string
  /** True when the values came from `resolveRange`. */
  live: boolean
}

export interface ResolvedSeries {
  series: ChartSeries
  group: ChartGroup
  name: string
  /** Numeric values (y values for scatter/bubble); null where blank, text, or an error. */
  values: (number | null)[]
  /** Raw category (or x) values. */
  categories?: ResolvedSource
  xValues?: (number | null)[]
  bubbleSizes?: (number | null)[]
  valueFormat?: string
  /** True when `values` were cut to the point limit. */
  truncated: boolean
}

function scalarToValue(value: Scalar): ChartValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof FormulaError) return null
  return String(value)
}

function callResolver(resolver: RangeResolver | undefined, formula: string | undefined): Scalar[][] | undefined {
  if (!resolver || !formula) return undefined
  try {
    const result = resolver(formula)
    return Array.isArray(result) ? result : undefined
  } catch {
    return undefined
  }
}

/** Flattens a resolved 2-D range along its longer side; returns the other side as levels. */
function flatten(rows: Scalar[][], wantLevels: boolean): { values: ChartValue[]; levels?: (string | null)[][] } {
  const height = rows.length
  const width = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
  if (!height || !width) return { values: [] }
  const byColumns = height >= width
  const count = Math.min(byColumns ? height : width, MAX_CHART_POINTS)
  const depth = byColumns ? width : height
  const at = (point: number, level: number) => (byColumns ? rows[point]?.[level] : rows[level]?.[point]) ?? null
  if (depth === 1 || !wantLevels) {
    const values: ChartValue[] = []
    if (depth === 1) for (let i = 0; i < count; i++) values.push(scalarToValue(at(i, 0)))
    else {
      // A 2-D range for values: read row by row.
      for (const row of rows) for (const cell of row ?? []) if (values.length < MAX_CHART_POINTS) values.push(scalarToValue(cell))
    }
    return { values }
  }
  // Multi-level categories: the last column (or row) is innermost.
  const levels: (string | null)[][] = []
  for (let level = depth - 1; level >= 0 && levels.length < 16; level--) {
    const labels: (string | null)[] = []
    for (let i = 0; i < count; i++) {
      const value = scalarToValue(at(i, level))
      labels.push(value === null ? null : String(value))
    }
    levels.push(labels)
  }
  return { values: levels[0] ? [...levels[0]] : [], levels }
}

export function resolveSource(source: DataSource | undefined, resolver: RangeResolver | undefined, wantLevels = false): ResolvedSource | undefined {
  if (!source) return undefined
  const live = callResolver(resolver, source.formula)
  if (live) {
    const flat = flatten(live, wantLevels)
    const result: ResolvedSource = { values: flat.values, live: true }
    if (flat.levels) result.levels = flat.levels
    if (source.formatCode) result.formatCode = source.formatCode
    return result
  }
  const result: ResolvedSource = { values: source.values, live: false }
  if (source.levels && source.levels.length > 1) result.levels = source.levels
  if (source.formatCode) result.formatCode = source.formatCode
  return result
}

/** Values as numbers: text counts as 0 (as in Excel), blanks and errors stay null. */
export function toNumbers(values: ChartValue[]): (number | null)[] {
  const result: (number | null)[] = new Array<number | null>(values.length)
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (typeof value === 'number') result[i] = value
    else if (typeof value === 'string') {
      const parsed = value.trim() === '' ? NaN : Number(value)
      result[i] = Number.isFinite(parsed) ? parsed : 0
    } else result[i] = null
  }
  return result
}

function resolveName(series: ChartSeries, resolver: RangeResolver | undefined): string {
  const live = callResolver(resolver, series.nameFormula)
  if (live) {
    const text = live
      .flat()
      .map((cell) => scalarToValue(cell))
      .filter((cell) => cell !== null)
      .join(' ')
    return text
  }
  if (series.name !== undefined) return series.name
  return `Series${series.index + 1}`
}

export function resolveSeries(group: ChartGroup, series: ChartSeries, resolver: RangeResolver | undefined): ResolvedSeries {
  const valueSource = resolveSource(series.values, resolver)
  const values = toNumbers(valueSource?.values ?? [])
  const resolved: ResolvedSeries = {
    series,
    group,
    name: resolveName(series, resolver),
    values,
    truncated: (valueSource?.values.length ?? 0) >= MAX_CHART_POINTS,
  }
  const format = valueSource?.formatCode
  if (format) resolved.valueFormat = format
  const categories = resolveSource(series.categories, resolver, true)
  if (categories) resolved.categories = categories
  const x = resolveSource(series.xValues, resolver)
  if (x) {
    // Text x values make Excel plot points at 1, 2, 3…
    const numeric = x.values.every((value) => value === null || typeof value === 'number')
    resolved.xValues = numeric ? toNumbers(x.values) : x.values.map((_, index) => index + 1)
  }
  const sizes = resolveSource(series.bubbleSizes, resolver)
  if (sizes) resolved.bubbleSizes = toNumbers(sizes.values)
  return resolved
}
