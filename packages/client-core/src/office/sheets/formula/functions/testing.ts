/**
 * A tiny stand-in for the evaluator, for testing library functions: an in-memory grid, a fake
 * `FunctionContext`, and `scalar` argument lifting as described in `types.ts`.
 */

import { parseCellName, parseRangeName } from '../../address.js'
import {
  Errors,
  isError,
  isMatrix,
  isReference,
  matrix,
  type FunctionContext,
  type FunctionSpec,
  type LambdaValue,
  type Matrix,
  type Reference,
  type Scalar,
  type Value,
} from '../types.js'
import { broadcastRanges } from '../ranges.js'
import { logicalSize, matrixGet } from '../types.js'
import { functionRegistry } from './index.js'

export interface TestContextOptions {
  /** Cells of sheet 0 by A1 name, or more sheets as an array. */
  cells?: Record<string, Scalar> | Record<string, Scalar>[]
  date1904?: boolean
  /** Serial NOW() returns. */
  now?: number
  /** Values RAND() returns, cycled. */
  random?: number[]
}

export interface TestContext extends FunctionContext {
  set(name: string, value: Scalar, sheet?: number): void
}

export function createContext(options: TestContextOptions = {}): TestContext {
  const sheets = (Array.isArray(options.cells) ? options.cells : [options.cells ?? {}]).map((cells) => {
    const map = new Map<string, Scalar>()
    for (const [name, value] of Object.entries(cells)) {
      const at = parseCellName(name)
      if (!at) throw new Error(`Bad cell name ${name}`)
      map.set(`${at.row}:${at.col}`, value)
    }
    return map
  })
  const randoms = options.random ?? [0.5]
  let randomIndex = 0
  const resolveArea = (area: Reference['areas'][number]): Matrix => {
    const sheet = sheets[area.sheet] ?? new Map<string, Scalar>()
    const rows = area.bottom - area.top + 1
    const cols = area.right - area.left + 1
    const data: Scalar[] = []
    for (let r = area.top; r <= area.bottom; r++) for (let c = area.left; c <= area.right; c++) data.push(sheet.get(`${r}:${c}`) ?? null)
    return matrix(rows, cols, data)
  }
  return {
    date1904: options.date1904 ?? false,
    sheet: 0,
    row: 0,
    col: 0,
    now: () => options.now ?? 45_000.5,
    random: () => randoms[randomIndex++ % randoms.length]!,
    resolve: (ref) => resolveArea(ref.areas[0]!),
    resolveAreas: (ref) => ref.areas.map(resolveArea),
    call: (lambda: LambdaValue) => {
      void lambda
      return Errors.CALC
    },
    set(name, value, sheet = 0) {
      const at = parseCellName(name)!
      while (sheets.length <= sheet) sheets.push(new Map())
      sheets[sheet]!.set(`${at.row}:${at.col}`, value)
    },
  }
}

/** A reference to `A1:B3` (or several comma-separated areas) on a sheet. */
export function ref(text: string, sheet = 0): Reference {
  return {
    kind: 'ref',
    areas: text.split(',').map((part) => {
      const range = parseRangeName(part)
      if (!range) throw new Error(`Bad range ${part}`)
      return { sheet, ...range }
    }),
  }
}

/** An array constant from rows. */
export function arr(rows: Scalar[][]): Matrix {
  return matrix(rows.length, rows[0]?.length ?? 0, rows.flat())
}

/** A column array constant. */
export function col(...values: Scalar[]): Matrix {
  return matrix(values.length, 1, values)
}

/** A row array constant. */
export function row(...values: Scalar[]): Matrix {
  return matrix(1, values.length, values)
}

/** Fills cells from rows starting at `origin` (default A1). */
export function grid(rows: Scalar[][], origin = 'A1'): Record<string, Scalar> {
  const start = parseCellName(origin)!
  const out: Record<string, Scalar> = {}
  rows.forEach((values, r) =>
    values.forEach((value, c) => {
      if (value === null) return
      let name = ''
      let n = start.col + c + 1
      while (n > 0) {
        name = String.fromCharCode(65 + ((n - 1) % 26)) + name
        n = Math.floor((n - 1) / 26)
      }
      out[`${name}${start.row + r + 1}`] = value
    }),
  )
  return out
}

/** Calls a spec the way the evaluator would, lifting arrays passed to `scalar` arguments. */
export function invoke(spec: FunctionSpec, ctx: FunctionContext, args: (Value | undefined)[]): Value {
  if (args.length < spec.minArgs || args.length > spec.maxArgs) throw new Error(`${spec.name} takes ${spec.minArgs}–${spec.maxArgs} arguments, got ${args.length}`)
  const kinds = spec.args ?? []
  const kindAt = (i: number): 'scalar' | 'any' => (kinds.length ? (kinds[Math.min(i, kinds.length - 1)] ?? 'scalar') : 'scalar')
  const prepared: (Value | undefined)[] = args.map((arg, i) => {
    if (kindAt(i) !== 'scalar' || arg === undefined) return arg
    if (isReference(arg)) {
      const m = ctx.resolve(arg)
      return logicalSize(m).rows === 1 && logicalSize(m).cols === 1 ? matrixGet(m, 0, 0) : m
    }
    if (isMatrix(arg) && logicalSize(arg).rows === 1 && logicalSize(arg).cols === 1) return matrixGet(arg, 0, 0)
    return arg
  })
  const lifted = prepared.map((arg, i) => (kindAt(i) === 'scalar' && isMatrix(arg) ? arg : undefined))
  if (!lifted.some(Boolean)) return spec.fn(ctx, prepared)
  return broadcastRanges(lifted.map((m) => m ?? null), (cells) => {
    const elementArgs = prepared.map((arg, i) => lifted[i] ? cells[i] : arg)
    const result = spec.fn(ctx, elementArgs)
    return isMatrix(result) ? matrixGet(result, 0, 0) : isReference(result) ? matrixGet(ctx.resolve(result), 0, 0) : result as Scalar
  })
}

const REGISTRY = functionRegistry()

/** Calls a library function by name. */
export function call(name: string, args: (Value | undefined)[], ctx: FunctionContext = createContext()): Value {
  const spec = REGISTRY.get(name.toUpperCase())
  if (!spec) throw new Error(`Unknown function ${name}`)
  return invoke(spec, ctx, args)
}

/** Error code of a value, or undefined if it is not an error. */
export function errorCode(value: Value): string | undefined {
  return isError(value) ? value.code : undefined
}

/** A matrix result as rows (for `toEqual`). */
export function rowsOf(value: Value): Scalar[][] {
  if (!isMatrix(value)) return [[value as Scalar]]
  return Array.from({ length: value.rows }, (_, r) => value.data.slice(r * value.cols, (r + 1) * value.cols))
}

/**
 * Compares a result with an expectation and describes the first mismatch (undefined when they
 * match). Numbers match within a relative tolerance (absolute when negative); `FormulaError`s match by code; nested arrays
 * describe a matrix result row by row.
 */
export function mismatch(actual: Value, expected: unknown, tolerance = 1e-9): string | undefined {
  if (Array.isArray(expected)) {
    if (!isMatrix(actual)) return `expected a matrix, got ${describe(actual)}`
    const rows = expected as unknown[][]
    if (actual.rows !== rows.length || actual.cols !== (rows[0]?.length ?? 0)) return `expected ${rows.length}×${rows[0]?.length ?? 0}, got ${actual.rows}×${actual.cols}: ${JSON.stringify(rowsOf(actual).map((r) => r.map(describe)))}`
    for (let r = 0; r < rows.length; r++)
      for (let c = 0; c < rows[r]!.length; c++) {
        const problem = mismatch(actual.data[r * actual.cols + c] ?? null, rows[r]![c], tolerance)
        if (problem) return `[${r},${c}] ${problem}`
      }
    return undefined
  }
  if (isError(expected)) return isError(actual) && actual.code === expected.code ? undefined : `expected ${expected.code}, got ${describe(actual)}`
  if (typeof expected === 'number') {
    if (typeof actual !== 'number') return `expected ${expected}, got ${describe(actual)}`
    if (actual === expected) return undefined
    // A negative tolerance is absolute (documented values rounded to cents, say).
    if (tolerance < 0) return Math.abs(actual - expected) <= -tolerance ? undefined : `expected ${expected} ± ${-tolerance}, got ${actual}`
    const scale = Math.max(Math.abs(expected), tolerance >= 1e-6 ? 1 : 1e-300)
    return Math.abs(actual - expected) <= tolerance * scale ? undefined : `expected ${expected}, got ${actual}`
  }
  return actual === expected ? undefined : `expected ${describe(expected as Value)}, got ${describe(actual)}`
}

function describe(value: Value | undefined): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'blank'
  if (isError(value)) return value.code
  if (isMatrix(value)) return `matrix ${value.rows}×${value.cols}`
  if (isReference(value)) return 'reference'
  if (typeof value === 'object') return 'lambda'
  return JSON.stringify(value)
}
