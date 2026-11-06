/** Logical range operations. Storage is only a prefix rectangle; its uniform tail is not an edge. */
import { consumeWork } from './budget.js'
import { checkArraySize, Errors, logicalSize, matrix, matrixGet, type FormulaError, type Matrix, type Scalar } from './types.js'

export function shaped(value: Matrix, rows: number, cols: number, omittedValue: Scalar = null): Matrix {
  if (value.rows === rows && value.cols === cols) return value
  return { ...value, logicalRows: rows, logicalCols: cols, omittedValue }
}

/** A slice retains its logical bounds without allocating the omitted tail. */
export function rangeSlice(value: Matrix, top: number, left: number, rows: number, cols: number): Matrix {
  const storedRows = Math.min(rows, Math.max(1, value.rows - top))
  const storedCols = Math.min(cols, Math.max(1, value.cols - left))
  checkArraySize(storedRows, storedCols)
  const data: Scalar[] = []
  for (let r = 0; r < storedRows; r++) for (let c = 0; c < storedCols; c++) data.push(matrixGet(value, top + r, left + c))
  return shaped(matrix(storedRows, storedCols, data), rows, cols, value.omittedValue ?? null)
}

/** For algorithms that require every cell, enforce the allocation limit before expanding. */
export function denseRange(value: Matrix): Matrix {
  const { rows, cols } = logicalSize(value)
  checkArraySize(rows, cols)
  if (rows === value.rows && cols === value.cols) return value
  const data: Scalar[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data.push(matrixGet(value, r, c))
  return matrix(rows, cols, data)
}

/**
 * Visit positional tuples, coalescing the uniform tail into a weighted visit. Flattened pairing
 * (Excel's paired statistics) permits different orientations with the same logical cell count.
 */
export function alignedRanges(values: Matrix[], visit: (cells: Scalar[], count: number) => void, error: FormulaError = Errors.VALUE, flatten = false): void {
  const first = logicalSize(values[0]!)
  const total = first.rows * first.cols
  for (const value of values) {
    const size = logicalSize(value)
    if (flatten ? size.rows * size.cols !== total : size.rows !== first.rows || size.cols !== first.cols) throw error
  }
  if (flatten && values.some((value) => logicalSize(value).cols !== first.cols)) {
    const indexes = new Set<number>()
    for (const value of values) {
      const size = logicalSize(value)
      for (let r = 0; r < value.rows; r++) for (let c = 0; c < value.cols; c++) indexes.add(r * size.cols + c)
    }
    const tail = values.map((value) => value.omittedValue ?? null)
    let next = 0
    for (const index of [...indexes].sort((a, b) => a - b)) {
      if (index > next) visit(tail, index - next)
      visit(values.map((value) => { const size = logicalSize(value); return matrixGet(value, Math.floor(index / size.cols), index % size.cols) }), 1)
      next = index + 1
    }
    if (next < total) visit(tail, total - next)
    consumeWork(indexes.size * values.length)
    return
  }
  const rows = Math.max(...values.map((value) => value.rows))
  const cols = Math.max(...values.map((value) => value.cols))
  consumeWork(rows * cols * values.length)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) visit(values.map((value) => matrixGet(value, r, c)), 1)
  const omitted = total - rows * cols
  if (omitted > 0) visit(values.map((value) => value.omittedValue ?? null), omitted)
}

/** Broadcast using logical edges. A compact result is safe only when its omitted region is uniform. */
export function broadcastRanges(values: (Scalar | Matrix)[], fn: (cells: Scalar[]) => Scalar): Matrix {
  const sizes = values.map((v) => typeof v === 'object' && v !== null && 'kind' in v ? logicalSize(v) : { rows: 1, cols: 1 })
  const rows = Math.max(...sizes.map((s) => s.rows))
  const cols = Math.max(...sizes.map((s) => s.cols))
  const matrices = values.map((v) => typeof v === 'object' && v !== null && 'kind' in v ? v : undefined)
  let storedRows = Math.max(...matrices.map((m) => m?.rows ?? 1))
  let storedCols = Math.max(...matrices.map((m) => m?.cols ?? 1))
  for (const size of sizes) {
    if (size.rows > 1 && size.rows < rows) storedRows = Math.max(storedRows, size.rows)
    if (size.cols > 1 && size.cols < cols) storedCols = Math.max(storedCols, size.cols)
  }
  const at = (r: number, c: number): Scalar => {
    let missing = false
    const cells = values.map((v, i) => {
      const m = matrices[i]
      if (!m) return v as Scalar
      const size = sizes[i]!
      const row = size.rows === 1 ? 0 : r
      const col = size.cols === 1 ? 0 : c
      if (row >= size.rows || col >= size.cols) { missing = true; return null }
      return matrixGet(m, row, col)
    })
    return missing ? Errors.NA : fn(cells)
  }
  // A row/column broadcast can make the tail vary along the other axis. Expand only when needed.
  const equal = (a: Scalar, b: Scalar): boolean => a === b || (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && a.code === b.code)
  if (storedRows < rows && storedCols > 1) {
    const tail = at(storedRows, 0)
    for (let c = 1; c < storedCols; c++) if (!equal(tail, at(storedRows, c))) { storedRows = rows; break }
  }
  checkArraySize(storedRows, storedCols)
  if (storedCols < cols && storedRows > 1) {
    const tail = at(0, storedCols)
    for (let r = 1; r < storedRows; r++) if (!equal(tail, at(r, storedCols))) { storedCols = cols; break }
  }
  checkArraySize(storedRows, storedCols)
  const data: Scalar[] = []
  for (let r = 0; r < storedRows; r++) for (let c = 0; c < storedCols; c++) data.push(at(r, c))
  const tail = storedRows < rows ? at(storedRows, 0) : storedCols < cols ? at(0, storedCols) : null
  if (storedRows < rows && storedCols < cols && !equal(tail, at(storedRows, storedCols))) {
    // The two omitted strips differ: this shape cannot use a uniform-tail representation.
    checkArraySize(rows, cols)
    const full: Scalar[] = []
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) full.push(at(r, c))
    return matrix(rows, cols, full)
  }
  return shaped(matrix(storedRows, storedCols, data), rows, cols, tail)
}
