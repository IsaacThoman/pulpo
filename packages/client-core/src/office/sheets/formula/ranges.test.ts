import { describe, expect, it } from 'vitest'
import { alignedRanges, broadcastRanges, denseRange, forEachLogical } from './ranges.js'
import { Errors, isMatrix, logicalSize, matrix, matrixGet, type Matrix, type Scalar, type Value } from './types.js'
import { call, createContext } from './functions/testing.js'

function compact(rows: number, cols: number, data: Scalar[], tail: Scalar = null): Matrix {
  return { ...matrix(rows, cols, data), logicalRows: 4, logicalCols: 5, omittedValue: tail }
}
function expanded(value: Value): unknown {
  return isMatrix(value) ? denseRange(value) : value
}
const a = compact(2, 2, [1, 2, 3, 4])
const b = compact(3, 1, [2, 6, 8])

describe('compact positional ranges', () => {
  it('pairs rectangular prefixes by logical coordinates rather than storage offsets', () => {
    const result: Scalar[][] = []
    alignedRanges([a, b], (cells, weight) => { for (let i = 0; i < weight; i++) result.push(cells) })
    const expected: Scalar[][] = []
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) expected.push([matrixGet(a, r, c), matrixGet(b, r, c)])
    expect(result).toEqual(expected)
  })
  it('pairs flattened ranges with different orientations and logical strides', () => {
    const row = { ...matrix(1, 3, [10, 20, 30]), logicalRows: 1, logicalCols: 20 }
    const result: Scalar[][] = []
    alignedRanges([a, row], (cells, weight) => { for (let i = 0; i < weight; i++) result.push(cells) }, Errors.NA, true)
    expect(result).toEqual(denseRange(a).data.map((value, i) => [value, i < 3 ? row.data[i] : null]))
  })
  it.each(['SUMPRODUCT', 'SUMX2MY2', 'SUMX2PY2', 'SUMXMY2', 'CORREL', 'COVAR', 'COVARIANCE.S', 'SLOPE', 'RSQ', 'CHISQ.TEST'])('%s agrees with fully stored rectangles', (name) => {
    expect(call(name, [a, b])).toEqual(call(name, [denseRange(a), denseRange(b)]))
  })
  it.each(['SUMIFS', 'AVERAGEIFS', 'MAXIFS', 'MINIFS'])('%s includes criteria and target tails', (name) => {
    expect(call(name, [a, b, ''])).toEqual(call(name, [denseRange(a), denseRange(b), '']))
  })
  it.each(['CHOOSECOLS', 'CHOOSEROWS'])('%s selects from logical negative indexes', (name) => {
    expect(expanded(call(name, [a, -1, 1]))).toEqual(expanded(call(name, [denseRange(a), -1, 1])))
  })
  it.each(['TAKE', 'DROP', 'EXPAND', 'TRANSPOSE', 'SORT', 'UNIQUE', 'HSTACK', 'VSTACK', 'TOCOL', 'TOROW'])('%s respects logical dimensions', (name) => {
    const extra = name === 'TAKE' || name === 'DROP' ? [-1] : name === 'EXPAND' ? [5, 6] : name === 'HSTACK' || name === 'VSTACK' ? [b] : []
    const fullExtra = extra.map((value) => isMatrix(value) ? denseRange(value) : value)
    expect(expanded(call(name, [a, ...extra]))).toEqual(expanded(call(name, [denseRange(a), ...fullExtra])))
  })
  it('broadcasts compact row/column operands with nonuniform omitted strips', () => {
    const column = { ...matrix(2, 1, [1, 2]), logicalRows: 4, logicalCols: 1 }
    const row = { ...matrix(1, 2, [10, 20]), logicalRows: 1, logicalCols: 5 }
    const add = ([x, y]: Scalar[]): Scalar => (typeof x === 'number' ? x : 0) + (typeof y === 'number' ? y : 0)
    expect(denseRange(broadcastRanges([column, row], add))).toEqual(broadcastRanges([denseRange(column), denseRange(row)], add))
  })
  it('keeps cells outside a smaller logical array as #N/A even for error-handling functions', () => {
    const ctx = createContext()
    const ragged = broadcastRanges([matrix(1, 2, [1, 2]), matrix(1, 3, [1, 2, 3])], () => true)
    expect(ragged.data).toEqual([true, true, Errors.NA])
    expect(call('SUMIFS', [a, b, ''], ctx)).toBe(6)
  })
  it('preserves uniform numeric/error tails and enforces bounded dense allocation', () => {
    const numeric = compact(1, 1, [2], 1)
    const result = call('SUMPRODUCT', [numeric, a])
    expect(result).toBe(11)
    expect(call('SUM', [numeric])).toBe(21)
    expect(call('SUMPRODUCT', [compact(1, 1, [2], Errors.DIV0), a])).toBe(Errors.DIV0)
    expect(() => denseRange({ ...numeric, logicalRows: 1_048_576 })).toThrow()
    expect(logicalSize(numeric)).toEqual({ rows: 4, cols: 5 })
  })
})

it('broadcasting compact prefixes agrees with expansion across shapes and tail values', () => {
  const values: Matrix[] = []
  for (const [rows, cols] of [[4, 5], [4, 1], [1, 5], [2, 3], [1, 1]] as const) {
    for (const tail of [null, 5]) {
      const storedRows = Math.min(rows, 2), storedCols = Math.min(cols, 2)
      values.push({ ...matrix(storedRows, storedCols, Array.from({ length: storedRows * storedCols }, (_, i) => i + 1)), logicalRows: rows, logicalCols: cols, omittedValue: tail })
    }
  }
  for (const a of values) for (const b of values) {
    const add = ([x, y]: Scalar[]): Scalar => (typeof x === 'number' ? x : 0) + (typeof y === 'number' ? y : 0)
    const result = broadcastRanges([a, b], add)
    const fullA = denseRange(a), fullB = denseRange(b)
    const rows = Math.max(fullA.rows, fullB.rows), cols = Math.max(fullA.cols, fullB.cols)
    const expected: Scalar[] = []
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const ar = fullA.rows === 1 ? 0 : r, ac = fullA.cols === 1 ? 0 : c
      const br = fullB.rows === 1 ? 0 : r, bc = fullB.cols === 1 ? 0 : c
      expected.push(ar >= fullA.rows || ac >= fullA.cols || br >= fullB.rows || bc >= fullB.cols ? Errors.NA : add([fullA.data[ar * fullA.cols + ac]!, fullB.data[br * fullB.cols + bc]!]))
    }
    expect(denseRange(result), JSON.stringify([logicalSize(a), logicalSize(b), a.omittedValue, b.omittedValue])).toEqual(matrix(rows, cols, expected))
  }
})


it('visits logical runs in row-major order without expanding the omitted strips', () => {
  const source = compact(2, 2, [1, 2, 3, 4], 'tail')
  const result: Scalar[] = []
  const runs: [Scalar, number][] = []
  forEachLogical(source, (v) => result.push(v))
  forEachLogical(source, (v, count) => runs.push([v, count]), { weightedTail: true })
  expect(result).toEqual(denseRange(source).data)
  expect(runs).toEqual([[1, 1], [2, 1], ['tail', 3], [3, 1], [4, 1], ['tail', 3], ['tail', 10]])
  let visits = 0, cells = 0
  forEachLogical({ ...matrix(1, 1, [1]), logicalRows: 1_048_576 }, (_, count) => { visits++; cells += count }, { weightedTail: true })
  expect(visits).toBe(2)
  expect(cells).toBe(1_048_576)
})
