/**
 * Dynamic-array functions: FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, TAKE, DROP, EXPAND, HSTACK,
 * VSTACK, TOCOL, TOROW, WRAPROWS, WRAPCOLS, CHOOSECOLS, CHOOSEROWS, TRANSPOSE. Results are
 * matrices; blank source cells stay `null` (the evaluator shows spilled blanks as 0 like Excel).
 */

import { maxOf } from '../../../../collections.js'

import { consumeWork, WorkCounter } from '../budget.js'
import { denseRange, rangeSlice, shaped } from '../ranges.js'
import { logicalSize, matrixGet, Errors, isError, matrix, type FunctionContext, type FunctionSpec, type Matrix, type Scalar, type Value } from '../types.js'
import {
  cell,
  check,
  checkArraySize,
  compareScalars,
  defBool,
  defInt,
  define,
  fail,
  int,
  num,
  omitted,
  scalarKey,
  scalarOf,
  toMatrix,
  transpose,
  type Args,
} from './coerce.js'

function rowsOf(m: Matrix): Scalar[][] {
  return Array.from({ length: m.rows }, (_, r) => Array.from({ length: m.cols }, (_, c) => matrixGet(m, r, c)))
}

function fromRows(rows: Scalar[][], cols?: number): Matrix {
  const width = cols ?? rows[0]?.length ?? 0
  if (!rows.length || !width) return fail(Errors.CALC)
  return matrix(rows.length, width, rows.flat())
}

function truthy(v: Scalar): boolean {
  if (isError(v)) return fail(v)
  if (typeof v === 'string') return fail(Errors.VALUE)
  return v === true || (typeof v === 'number' && v !== 0)
}

function filter(ctx: FunctionContext, args: Args): Value {
  const source = toMatrix(ctx, args[0])
  const include = toMatrix(ctx, args[1])
  const empty = (): Value => (omitted(args, 2) ? fail(Errors.CALC) : args[2] === undefined ? null : scalarOrMatrix(ctx, args[2]))
  const size = logicalSize(source)
  const inc = logicalSize(include)
  const byRow = inc.cols === 1 && inc.rows === size.rows
  const byCol = inc.rows === 1 && inc.cols === size.cols
  if (byRow || byCol) {
    const m = byRow ? source : transpose(source)
    const mask = byRow ? include : transpose(include)
    const logical = logicalSize(m)
    const prefix = Math.max(m.rows, mask.rows)
    const rows: Scalar[][] = []
    for (let r = 0; r < prefix; r++) {
      if (!truthy(cell(mask, r, 0))) continue
      checkArraySize(rows.length + 1, m.cols)
      rows.push(Array.from({ length: m.cols }, (_, c) => cell(m, r, c)))
    }
    const tail = logical.rows > prefix && truthy(mask.omittedValue ?? null) ? logical.rows - prefix : 0
    const count = rows.length + tail
    if (!count) return empty()
    if (!rows.length) rows.push(new Array<Scalar>(m.cols).fill(m.omittedValue ?? null))
    const result = shaped(fromRows(rows, m.cols), count, logical.cols, m.omittedValue ?? null)
    return byRow ? result : transpose(result)
  }
  return fail(Errors.VALUE)
}

function scalarOrMatrix(ctx: FunctionContext, value: Value | undefined): Value {
  const m = toMatrix(ctx, value)
  return logicalSize(m).rows * logicalSize(m).cols === 1 ? (m.data[0] ?? null) : m
}

/** Sort comparison: values in Excel's type order, reversed for descending; blanks always last. */
function sortCompare(a: Scalar, b: Scalar, order: number): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return compareScalars(a, b) * order
}

interface SortKey {
  values: Scalar[]
  order: number
}

function sortLines(lines: Scalar[][], keys: SortKey[]): Scalar[][] {
  const work = new WorkCounter()
  const indexed = lines.map((line, i) => ({ line, i }))
  indexed.sort((x, y) => {
    for (const key of keys) {
      work.consume()
      const c = sortCompare(key.values[x.i] ?? null, key.values[y.i] ?? null, key.order)
      if (c) return c
    }
    return x.i - y.i
  })
  work.flush()
  return indexed.map((x) => x.line)
}

function orderOf(v: Scalar): number {
  const n = typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : fail(Errors.VALUE)
  if (n !== 1 && n !== -1) return fail(Errors.VALUE)
  return n
}

function sort(ctx: FunctionContext, args: Args): Value {
  let source = toMatrix(ctx, args[0])
  if (source.omittedValue != null) source = denseRange(source)
  const byCol = defBool(args, 3, false, ctx)
  const m = byCol ? transpose(source) : source
  const indexes = omitted(args, 1) ? [1] : denseRange(toMatrix(ctx, args[1])).data.map((v) => int(v, ctx))
  const orders = omitted(args, 2) ? [1] : denseRange(toMatrix(ctx, args[2])).data.map(orderOf)
  const lines = rowsOf(m)
  consumeWork(indexes.length * lines.length)
  const keys = indexes.map((index, k) => {
    if (index < 1 || index > logicalSize(m).cols) fail(Errors.VALUE)
    return { values: lines.map((line) => line[index - 1] ?? null), order: orders[Math.min(k, orders.length - 1)] ?? 1 }
  })
  const size = logicalSize(m)
  const result = shaped(fromRows(sortLines(lines, keys), m.cols), size.rows, size.cols, m.omittedValue ?? null)
  return byCol ? transpose(result) : result
}

function sortBy(ctx: FunctionContext, args: Args): Value {
  let source = toMatrix(ctx, args[0])
  const size = logicalSize(source)
  const ranges: Matrix[] = []
  const orders: number[] = []
  let byCol: boolean | undefined
  for (let i = 1; i < args.length; i += 2) {
    const by = toMatrix(ctx, args[i])
    const keySize = logicalSize(by)
    let thisByCol: boolean
    if (keySize.cols === 1 && keySize.rows === size.rows) thisByCol = false
    else if (keySize.rows === 1 && keySize.cols === size.cols) thisByCol = true
    else return fail(Errors.VALUE)
    if (keySize.rows === 1 && keySize.cols === 1) thisByCol = byCol ?? false
    if (byCol !== undefined && byCol !== thisByCol) return fail(Errors.VALUE)
    byCol = thisByCol
    ranges.push(by)
    orders.push(i + 1 < args.length && args[i + 1] !== undefined ? orderOf(scalarOf(args[i + 1], ctx)) : 1)
  }
  // Blank keys sort last, so their uniform omitted tail remains at the end, stably.
  if (ranges.some((key) => key.omittedValue != null)) {
    source = denseRange(source)
    for (let i = 0; i < ranges.length; i++) ranges[i] = denseRange(ranges[i]!)
  }
  const m = byCol ? transpose(source) : source
  const keys = ranges.map((key) => byCol ? transpose(key) : key)
  const rows = Math.max(m.rows, maxOf(keys.map((key) => key.rows)))
  checkArraySize(rows, m.cols)
  const lines = Array.from({ length: rows }, (_, r) => Array.from({ length: m.cols }, (_, c) => cell(m, r, c)))
  consumeWork(rows * keys.length)
  const sortKeys = keys.map((key, i) => ({ values: Array.from({ length: rows }, (_, r) => cell(key, r, 0)), order: orders[i]! }))
  const logical = logicalSize(m)
  const result = shaped(fromRows(sortLines(lines, sortKeys), m.cols), logical.rows, logical.cols, m.omittedValue ?? null)
  return byCol ? transpose(result) : result
}

function unique(ctx: FunctionContext, args: Args): Value {
  const source = toMatrix(ctx, args[0])
  const byCol = defBool(args, 1, false, ctx)
  const exactlyOnce = defBool(args, 2, false, ctx)
  const m = byCol ? transpose(source) : source
  const size = logicalSize(m)
  const lines = rowsOf(m)
  const tailRows = size.rows - m.rows
  if (tailRows) lines.push(new Array<Scalar>(m.cols).fill(m.omittedValue ?? null))
  const counts = new Map<string, number>()
  const keyOf = (line: Scalar[]): string => line.map((v) => scalarKey(v === '' ? null : v)).join('\u0000')
  lines.forEach((line, i) => { const key = keyOf(line); counts.set(key, (counts.get(key) ?? 0) + (i === m.rows ? tailRows : 1)) })
  const seen = new Set<string>()
  const out: Scalar[][] = []
  for (const line of lines) {
    const key = keyOf(line)
    if (seen.has(key)) continue
    seen.add(key)
    if (exactlyOnce && counts.get(key) !== 1) continue
    out.push(line)
  }
  if (!out.length) return fail(Errors.CALC)
  const result = shaped(fromRows(out, m.cols), out.length, size.cols, m.omittedValue ?? null)
  return byCol ? transpose(result) : result
}

function sequence(ctx: FunctionContext, args: Args): Value {
  const rows = defInt(args, 0, 1, ctx)
  const cols = defInt(args, 1, 1, ctx)
  const start = omitted(args, 2) ? 1 : num(args[2], ctx)
  const step = omitted(args, 3) ? 1 : num(args[3], ctx)
  check(rows >= 0 && cols >= 0, Errors.VALUE)
  if (rows === 0 || cols === 0) return fail(Errors.CALC)
  checkArraySize(rows, cols)
  const data: number[] = []
  for (let i = 0; i < rows * cols; i++) data.push(start + i * step)
  return matrix(rows, cols, data)
}

/** Indexes kept by TAKE (count > 0 from the start, < 0 from the end). */
function takeRange(total: number, count: number): [number, number] {
  if (count >= 0) return [0, Math.min(count, total)]
  return [Math.max(0, total + count), total]
}

function dropRange(total: number, count: number): [number, number] {
  if (count >= 0) return [Math.min(count, total), total]
  return [0, Math.max(0, total + count)]
}

function slice(m: Matrix, rows: [number, number], cols: [number, number]): Matrix {
  if (rows[1] <= rows[0] || cols[1] <= cols[0]) return fail(Errors.CALC)
  return rangeSlice(m, rows[0], cols[0], rows[1] - rows[0], cols[1] - cols[0])
}

function takeDrop(ctx: FunctionContext, args: Args, take: boolean): Value {
  const m = toMatrix(ctx, args[0])
  const rowCount = omitted(args, 1) ? undefined : int(args[1], ctx)
  const colCount = omitted(args, 2) ? undefined : int(args[2], ctx)
  if (take && (rowCount === 0 || colCount === 0)) return fail(Errors.CALC)
  const size = logicalSize(m)
  const pick = take ? takeRange : dropRange
  const rows: [number, number] = rowCount === undefined ? [0, size.rows] : pick(size.rows, rowCount)
  const cols: [number, number] = colCount === undefined ? [0, size.cols] : pick(size.cols, colCount)
  if (rows[1] <= rows[0] || cols[1] <= cols[0]) return fail(Errors.CALC)
  return slice(m, rows, cols)
}

function expand(ctx: FunctionContext, args: Args): Value {
  const m = toMatrix(ctx, args[0])
  const size = logicalSize(m)
  const rows = omitted(args, 1) ? size.rows : int(args[1], ctx)
  const cols = omitted(args, 2) ? size.cols : int(args[2], ctx)
  const pad: Scalar = args.length > 3 ? scalarOf(args[3], ctx) : Errors.NA
  if (rows < size.rows || cols < size.cols) return fail(Errors.VALUE)
  checkArraySize(rows, cols)
  const data: Scalar[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data.push(r < size.rows && c < size.cols ? cell(m, r, c) : pad)
  return matrix(rows, cols, data)
}

function stack(ctx: FunctionContext, args: Args, horizontal: boolean): Value {
  const parts = args.map((a) => denseRange(toMatrix(ctx, a)))
  if (horizontal) {
    const rows = maxOf(parts.map((p) => p.rows))
    const cols = parts.reduce((n, p) => n + p.cols, 0)
    checkArraySize(rows, cols)
    const data: Scalar[] = []
    for (let r = 0; r < rows; r++) for (const p of parts) for (let c = 0; c < p.cols; c++) data.push(r < p.rows ? cell(p, r, c) : Errors.NA)
    return matrix(rows, cols, data)
  }
  const cols = maxOf(parts.map((p) => p.cols))
  const rows = parts.reduce((n, p) => n + p.rows, 0)
  checkArraySize(rows, cols)
  const data: Scalar[] = []
  for (const p of parts) for (let r = 0; r < p.rows; r++) for (let c = 0; c < cols; c++) data.push(c < p.cols ? cell(p, r, c) : Errors.NA)
  return matrix(rows, cols, data)
}

function flatten(ctx: FunctionContext, args: Args): Scalar[] {
  const m = denseRange(toMatrix(ctx, args[0]))
  const ignore = defInt(args, 1, 0, ctx)
  check(ignore >= 0 && ignore <= 3, Errors.VALUE)
  const byColumn = defBool(args, 2, false, ctx)
  const values = byColumn ? transpose(m).data : m.data
  return values.filter((v) => !((ignore & 1 && v === null) || (ignore & 2 && isError(v))))
}

function wrap(ctx: FunctionContext, args: Args, byRows: boolean): Value {
  const m = denseRange(toMatrix(ctx, args[0]))
  if (m.rows > 1 && m.cols > 1) return fail(Errors.VALUE)
  const count = int(args[1], ctx)
  check(count >= 1)
  const pad: Scalar = args.length > 2 ? scalarOf(args[2], ctx) : Errors.NA
  const values = m.data
  const lines = Math.ceil(values.length / count)
  checkArraySize(lines, count)
  const data: Scalar[] = []
  for (let i = 0; i < lines * count; i++) data.push(i < values.length ? (values[i] ?? null) : pad)
  const result = matrix(lines, count, data)
  return byRows ? result : transpose(result)
}

function choose(ctx: FunctionContext, args: Args, columns: boolean): Value {
  const m = toMatrix(ctx, args[0])
  const size = logicalSize(m)
  const total = columns ? size.cols : size.rows
  const picks: number[] = []
  for (const arg of args.slice(1)) {
    const values = denseRange(toMatrix(ctx, arg)).data
    checkArraySize(picks.length + values.length, columns ? m.rows : m.cols)
    for (const v of values) {
      const n = int(v, ctx)
      if (n === 0 || Math.abs(n) > total) return fail(Errors.VALUE)
      picks.push(n > 0 ? n - 1 : total + n)
    }
  }
  if (columns) {
    const rows = Array.from({ length: m.rows }, (_, r) => picks.map((c) => cell(m, r, c)))
    return shaped(fromRows(rows, picks.length), size.rows, picks.length, m.omittedValue ?? null)
  }
  const rows = picks.map((r) => Array.from({ length: m.cols }, (_, c) => cell(m, r, c)))
  return shaped(fromRows(rows, m.cols), picks.length, size.cols, m.omittedValue ?? null)
}

export const ARRAY_FUNCTIONS: FunctionSpec[] = [
  define({ name: 'FILTER', min: 2, max: 3, args: ['any'], xlfn: true, fn: filter }),
  define({ name: 'SORT', min: 1, max: 4, args: ['any', 'any', 'any', 'scalar'], xlfn: true, fn: sort }),
  define({ name: 'SORTBY', min: 2, max: 253, args: ['any'], xlfn: true, fn: sortBy }),
  define({ name: 'UNIQUE', min: 1, max: 3, args: ['any', 'scalar'], xlfn: true, fn: unique }),
  define({ name: 'SEQUENCE', min: 1, max: 4, xlfn: true, fn: sequence }),
  define({ name: 'TAKE', min: 2, max: 3, args: ['any', 'scalar'], xlfn: true, fn: (ctx, args) => takeDrop(ctx, args, true) }),
  define({ name: 'DROP', min: 2, max: 3, args: ['any', 'scalar'], xlfn: true, fn: (ctx, args) => takeDrop(ctx, args, false) }),
  define({ name: 'EXPAND', min: 2, max: 4, args: ['any', 'scalar'], xlfn: true, fn: expand }),
  define({ name: 'HSTACK', min: 1, max: 254, args: ['any'], xlfn: true, fn: (ctx, args) => stack(ctx, args, true) }),
  define({ name: 'VSTACK', min: 1, max: 254, args: ['any'], xlfn: true, fn: (ctx, args) => stack(ctx, args, false) }),
  define({
    name: 'TOCOL',
    min: 1,
    max: 3,
    args: ['any', 'scalar'],
    xlfn: true,
    fn: (ctx, args) => {
      const values = flatten(ctx, args)
      return values.length ? matrix(values.length, 1, values) : fail(Errors.CALC)
    },
  }),
  define({
    name: 'TOROW',
    min: 1,
    max: 3,
    args: ['any', 'scalar'],
    xlfn: true,
    fn: (ctx, args) => {
      const values = flatten(ctx, args)
      return values.length ? matrix(1, values.length, values) : fail(Errors.CALC)
    },
  }),
  define({ name: 'WRAPROWS', min: 2, max: 3, args: ['any', 'scalar'], xlfn: true, fn: (ctx, args) => wrap(ctx, args, true) }),
  define({ name: 'WRAPCOLS', min: 2, max: 3, args: ['any', 'scalar'], xlfn: true, fn: (ctx, args) => wrap(ctx, args, false) }),
  define({ name: 'CHOOSECOLS', min: 2, max: 255, args: ['any'], xlfn: true, fn: (ctx, args) => choose(ctx, args, true) }),
  define({ name: 'CHOOSEROWS', min: 2, max: 255, args: ['any'], xlfn: true, fn: (ctx, args) => choose(ctx, args, false) }),
  define({ name: 'TRANSPOSE', min: 1, max: 1, args: ['any'], fn: (ctx, args) => transpose(toMatrix(ctx, args[0])) }),
]
