/**
 * Functions the evaluator implements itself because they evaluate arguments lazily (IF, IFERROR,
 * CHOOSE, …), bind names (LET, LAMBDA), call lambdas (MAP, REDUCE, …), or work on references rather
 * than values (ROW, INDEX, OFFSET, INDIRECT, …). These win over library functions of the same name.
 */

import { maxOf } from '../../../collections.js'

import { broadcastRanges, rangeSlice } from './ranges.js'
import { logicalSize, matrixGet, omittedCells } from './types.js'


import { MAX_COLS, MAX_ROWS, columnName, quoteSheetName } from '../address.js'
import type { Interpreter, Scope } from './evaluate.js'
import { parseFormula, type Node } from './parse.js'
import { r1c1ToA1 } from './translate.js'
import {
  Errors,
  checkArraySize,
  isError,
  isLambda,
  isMatrix,
  isReference,
  matrix,
  type Area,
  type FormulaError,
  type LambdaValue,
  type Matrix,
  type Reference,
  type Scalar,
  type Value,
} from './types.js'
import { compareScalars, toBoolean, toNumber, toText } from './values.js'

export type OwnedFunction = (it: Interpreter, args: readonly (Node | null)[], scope: Scope | undefined) => Value

type Args = readonly (Node | null)[]

/** An operand for lazy-lifting functions: a scalar, or an array to lift over. */
type Liftable = Scalar | Matrix

function liftable(it: Interpreter, node: Node | null | undefined, scope: Scope | undefined, missing: Scalar): Liftable {
  if (node === undefined) return missing
  if (node === null) return 0
  const value = it.scalarArg(it.eval(node, scope))
  return isLambda(value) ? Errors.CALC : value
}

/** Element-wise combination of several lifted operands. */
function liftAll(values: Liftable[], fn: (row: Scalar[]) => Scalar): Matrix {
  return broadcastRanges(values, fn)
}

function integer(value: Scalar, date1904: boolean, currentYear: number): number | FormulaError {
  const n = toNumber(value, date1904, currentYear)
  return isError(n) ? n : Math.trunc(n)
}

function areaRows(area: Area): number {
  return area.bottom - area.top + 1
}

function areaCols(area: Area): number {
  return area.right - area.left + 1
}

function cellRef(sheet: number, row: number, col: number): Reference {
  return { kind: 'ref', areas: [{ sheet, top: row, left: col, bottom: row, right: col }] }
}

// ---------------------------------------------------------------------------------------------
// Conditionals

const IF: OwnedFunction = (it, args, scope) => {
  if (args.length < 2 || args.length > 3) return Errors.VALUE
  const condition = liftable(it, args[0], scope, false)
  if (isMatrix(condition)) {
    const whenTrue = liftable(it, args[1], scope, true)
    const whenFalse = liftable(it, args[2], scope, false)
    return liftAll([condition, whenTrue, whenFalse], ([c, t, f]) => {
      const test = toBoolean(c!)
      return isError(test) ? test : test ? t! : f!
    })
  }
  const test = toBoolean(condition)
  if (isError(test)) return test
  const index = test ? 1 : 2
  if (index >= args.length) return false
  const branch = args[index]
  return branch ? it.eval(branch, scope) : 0
}

const IFS: OwnedFunction = (it, args, scope) => {
  if (args.length < 2 || args.length % 2) return Errors.VALUE
  for (let i = 0; i < args.length; i += 2) {
    const condition = liftable(it, args[i], scope, false)
    if (isMatrix(condition)) {
      // An array condition: evaluate everything and pick per element.
      // Earlier conditions were all FALSE, so only this pair onwards matters.
      const values: Liftable[] = [condition]
      for (let k = i + 1; k < args.length; k++) values.push(liftable(it, args[k], scope, 0))
      return liftAll(values, (row) => {
        for (let k = 0; k < row.length; k += 2) {
          const test = toBoolean(row[k]!)
          if (isError(test)) return test
          if (test) return row[k + 1]!
        }
        return Errors.NA
      })
    }
    const test = toBoolean(condition)
    if (isError(test)) return test
    if (test) {
      const value = args[i + 1]
      return value ? it.eval(value, scope) : 0
    }
  }
  return Errors.NA
}

function errorHandler(onlyNA: boolean): OwnedFunction {
  return (it, args, scope) => {
    if (args.length !== 2) return Errors.VALUE
    const value = liftable(it, args[0], scope, null)
    const catches = (v: Scalar) => isError(v) && (!onlyNA || v.code === '#N/A')
    if (isMatrix(value)) {
      if (!value.data.some(catches) && !(omittedCells(value) && catches(value.omittedValue ?? null))) return value
      const fallback = liftable(it, args[1], scope, 0)
      return liftAll([value, fallback], ([v, f]) => (catches(v!) ? f! : v!))
    }
    if (!catches(value)) return value
    const fallback = args[1]
    return fallback ? it.eval(fallback, scope) : 0
  }
}

const SWITCH: OwnedFunction = (it, args, scope) => {
  if (args.length < 3) return Errors.VALUE
  const subject = liftable(it, args[0], scope, null)
  const pairs = Math.floor((args.length - 1) / 2)
  const hasDefault = (args.length - 1) % 2 === 1
  const matches = (a: Scalar, b: Scalar) => !isError(a) && !isError(b) && compareScalars(a, b) === 0
  if (isMatrix(subject)) {
    const values: Liftable[] = [subject]
    for (let k = 1; k < args.length; k++) values.push(liftable(it, args[k], scope, null))
    return liftAll(values, (row) => {
      const v = row[0]!
      if (isError(v)) return v
      for (let p = 0; p < pairs; p++) if (matches(v, row[1 + p * 2]!)) return row[2 + p * 2]!
      return hasDefault ? row[row.length - 1]! : Errors.NA
    })
  }
  if (isError(subject)) return subject
  for (let p = 0; p < pairs; p++) {
    const candidate = it.toScalar(it.arg(args[1 + p * 2], scope))
    if (isError(candidate)) return candidate
    if (matches(subject, candidate)) {
      const result = args[2 + p * 2]
      return result ? it.eval(result, scope) : 0
    }
  }
  if (!hasDefault) return Errors.NA
  const fallback = args[args.length - 1]
  return fallback ? it.eval(fallback, scope) : 0
}

const CHOOSE: OwnedFunction = (it, args, scope) => {
  if (args.length < 2) return Errors.VALUE
  const index = liftable(it, args[0], scope, null)
  const choices = args.length - 1
  if (isMatrix(index)) {
    const values: Liftable[] = [index]
    for (let k = 1; k < args.length; k++) values.push(liftable(it, args[k], scope, 0))
    return liftAll(values, (row) => {
      const n = integer(row[0]!, it.host.date1904, it.currentYear())
      if (isError(n)) return n
      return n >= 1 && n <= choices ? row[n]! : Errors.VALUE
    })
  }
  const n = integer(index, it.host.date1904, it.currentYear())
  if (isError(n)) return n
  if (n < 1 || n > choices) return Errors.VALUE
  const choice = args[n]
  return choice ? it.eval(choice, scope) : 0
}

// ---------------------------------------------------------------------------------------------
// Names and lambdas

function variableName(node: Node | null | undefined): string | undefined {
  if (node?.type === 'name' && !node.sheet) return node.name
  return undefined
}

const LET: OwnedFunction = (it, args, scope) => {
  if (args.length < 3 || args.length % 2 === 0) return Errors.VALUE
  const inner = it.childScope(scope)
  for (let i = 0; i < args.length - 1; i += 2) {
    const name = variableName(args[i])
    if (!name) return Errors.NAME
    const value = args[i + 1]
    inner.vars.set(name, { value: value ? it.eval(value, inner) : null })
  }
  const body = args[args.length - 1]
  return body ? it.eval(body, inner) : 0
}

const LAMBDA: OwnedFunction = (_it, args, scope) => {
  if (!args.length) return Errors.VALUE
  const params: string[] = []
  for (let i = 0; i < args.length - 1; i++) {
    const node = args[i]
    let name = variableName(node)
    // Optional parameters are written in brackets: LAMBDA(x, [y], …).
    if (!name && node?.type === 'structured' && !node.ref.table && !node.ref.items.length && node.ref.lastColumn === undefined) {
      name = node.ref.firstColumn?.trim().toUpperCase().replace(/^_XLPM\./, '')
    }
    if (!name || params.includes(name)) return Errors.VALUE
    params.push(name)
  }
  const body = args[args.length - 1]
  if (!body) return Errors.VALUE
  const lambda: LambdaValue = { kind: 'lambda', params, body, closure: scope }
  return lambda
}

const ISOMITTED: OwnedFunction = (_it, args, scope) => {
  if (args.length !== 1) return Errors.VALUE
  const name = variableName(args[0])
  return name !== undefined && scope?.lookup(name)?.omitted === true
}

/** An argument viewed as a grid of elements: cells of a range (as references), or array values. */
interface Grid {
  rows: number
  cols: number
  at(row: number, col: number): Value
  row(row: number): Value
  col(col: number): Value
}

function gridOf(it: Interpreter, value: Value): Grid | FormulaError {
  if (isError(value)) return value
  if (isReference(value)) {
    if (value.areas.length !== 1) return Errors.VALUE
    const area = value.areas[0]!
    return {
      rows: areaRows(area),
      cols: areaCols(area),
      at: (r, c) => cellRef(area.sheet, area.top + r, area.left + c),
      row: (r) => ({ kind: 'ref', areas: [{ ...area, top: area.top + r, bottom: area.top + r }] }),
      col: (c) => ({ kind: 'ref', areas: [{ ...area, left: area.left + c, right: area.left + c }] }),
    }
  }
  if (isMatrix(value)) {
    return {
      ...logicalSize(value),
      at: (r, c) => matrixGet(value, r, c),
      row: (r) => rangeSlice(value, r, 0, 1, logicalSize(value).cols),
      col: (c) => rangeSlice(value, 0, c, logicalSize(value).rows, 1),
    }
  }
  if (isLambda(value)) return Errors.VALUE
  return { rows: 1, cols: 1, at: () => value, row: () => value, col: () => value }
}

function lambdaArg(it: Interpreter, node: Node | null | undefined, scope: Scope | undefined, params: number): LambdaValue | FormulaError {
  const value = it.arg(node, scope)
  if (isError(value)) return value
  if (!isLambda(value) || value.params.length !== params) return Errors.VALUE
  return value
}

const MAP: OwnedFunction = (it, args, scope) => {
  if (args.length < 2) return Errors.VALUE
  const lambda = lambdaArg(it, args[args.length - 1], scope, args.length - 1)
  if (isError(lambda)) return lambda
  const grids: Grid[] = []
  for (let i = 0; i < args.length - 1; i++) {
    const grid = gridOf(it, it.arg(args[i], scope) ?? null)
    if (isError(grid)) return grid
    grids.push(grid)
  }
  const rows = maxOf(grids.map((grid) => grid.rows))
  const cols = maxOf(grids.map((grid) => grid.cols))
  checkArraySize(rows, cols)
  const data: Scalar[] = new Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let missing = false
      const values = grids.map((grid) => {
        const gr = grid.rows === 1 ? 0 : r
        const gc = grid.cols === 1 ? 0 : c
        if (gr >= grid.rows || gc >= grid.cols) {
          missing = true
          return null
        }
        return grid.at(gr, gc)
      })
      data[r * cols + c] = missing ? Errors.NA : it.elementResult(it.invoke(lambda, values))
    }
  }
  return matrix(rows, cols, data)
}

function reduceLike(collect: boolean): OwnedFunction {
  return (it, args, scope) => {
    if (args.length !== 3 && args.length !== 2) return Errors.VALUE
    const offset = args.length === 3 ? 1 : 0
    const lambda = lambdaArg(it, args[offset + 1], scope, 2)
    if (isError(lambda)) return lambda
    const initial = offset ? it.arg(args[0], scope) : undefined
    let acc: Value = initial === undefined ? null : isReference(initial) ? it.operand(initial) : initial
    const grid = gridOf(it, it.arg(args[offset], scope) ?? null)
    if (isError(grid)) return grid
    if (collect) checkArraySize(grid.rows, grid.cols)
    const data: Scalar[] = []
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        acc = it.invoke(lambda, [acc, grid.at(r, c)])
        if (collect) data.push(it.elementResult(acc))
      }
    }
    return collect ? matrix(grid.rows, grid.cols, data) : acc
  }
}

function byLine(rows: boolean): OwnedFunction {
  return (it, args, scope) => {
    if (args.length !== 2) return Errors.VALUE
    const lambda = lambdaArg(it, args[1], scope, 1)
    if (isError(lambda)) return lambda
    const grid = gridOf(it, it.arg(args[0], scope) ?? null)
    if (isError(grid)) return grid
    const count = rows ? grid.rows : grid.cols
    checkArraySize(count, 1)
    const data: Scalar[] = []
    for (let i = 0; i < count; i++) data.push(it.elementResult(it.invoke(lambda, [rows ? grid.row(i) : grid.col(i)])))
    return rows ? matrix(count, 1, data) : matrix(1, count, data)
  }
}

const MAKEARRAY: OwnedFunction = (it, args, scope) => {
  if (args.length !== 3) return Errors.VALUE
  const rows = integer(it.toScalar(it.arg(args[0], scope)), it.host.date1904, it.currentYear())
  if (isError(rows)) return rows
  const cols = integer(it.toScalar(it.arg(args[1], scope)), it.host.date1904, it.currentYear())
  if (isError(cols)) return cols
  if (rows < 1 || cols < 1) return Errors.VALUE
  checkArraySize(rows, cols)
  const lambda = lambdaArg(it, args[2], scope, 2)
  if (isError(lambda)) return lambda
  checkArraySize(rows, cols)
  const data: Scalar[] = new Array(rows * cols)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data[r * cols + c] = it.elementResult(it.invoke(lambda, [r + 1, c + 1]))
  return matrix(rows, cols, data)
}

// ---------------------------------------------------------------------------------------------
// References

function referenceArg(it: Interpreter, node: Node | null | undefined, scope: Scope | undefined): Reference | FormulaError {
  const value = it.arg(node, scope)
  if (isError(value)) return value
  if (!isReference(value)) return Errors.VALUE
  return value
}

function rowOrColumn(rows: boolean): OwnedFunction {
  return (it, args, scope) => {
    if (args.length > 1) return Errors.VALUE
    if (!args.length || !args[0]) return (rows ? it.row : it.col) + 1
    const ref = referenceArg(it, args[0], scope)
    if (isError(ref)) return ref
    // Coordinates describe the reference, including cells beyond the populated prefix.
    const area = ref.areas[0]!
    const start = rows ? area.top : area.left
    const count = rows ? areaRows(area) : areaCols(area)
    if (count === 1 || it.legacy) return start + 1
    checkArraySize(count, 1)
    const data: Scalar[] = []
    for (let i = 0; i < count; i++) data.push(start + i + 1)
    return rows ? matrix(count, 1, data) : matrix(1, count, data)
  }
}

function dimension(rows: boolean): OwnedFunction {
  return (it, args, scope) => {
    if (args.length !== 1) return Errors.VALUE
    const value = it.arg(args[0], scope)
    if (value === undefined) return Errors.VALUE
    if (isError(value)) return value
    if (isReference(value)) {
      if (value.areas.length !== 1) return Errors.REF
      return rows ? areaRows(value.areas[0]!) : areaCols(value.areas[0]!)
    }
    if (isMatrix(value)) return rows ? value.logicalRows ?? value.rows : value.logicalCols ?? value.cols
    if (isLambda(value)) return Errors.VALUE
    return 1
  }
}

const AREAS: OwnedFunction = (it, args, scope) => {
  if (args.length !== 1) return Errors.VALUE
  const ref = referenceArg(it, args[0], scope)
  return isError(ref) ? ref : ref.areas.length
}

const OFFSET: OwnedFunction = (it, args, scope) => {
  if (args.length < 3 || args.length > 5) return Errors.VALUE
  const ref = referenceArg(it, args[0], scope)
  if (isError(ref)) return ref
  if (ref.areas.length !== 1) return Errors.VALUE
  const base = ref.areas[0]!
  const numbers: number[] = []
  for (let i = 1; i < 5; i++) {
    const node = args[i]
    if (i >= 3 && !node) {
      numbers.push(i === 3 ? areaRows(base) : areaCols(base))
      continue
    }
    const n = integer(it.toScalar(it.arg(node, scope) ?? 0), it.host.date1904, it.currentYear())
    if (isError(n)) return n
    numbers.push(n)
  }
  const [rows, cols, height, width] = numbers as [number, number, number, number]
  if (height < 1 || width < 1) return Errors.REF
  const top = base.top + rows
  const left = base.left + cols
  const bottom = top + height - 1
  const right = left + width - 1
  if (top < 0 || left < 0 || bottom >= MAX_ROWS || right >= MAX_COLS) return Errors.REF
  return { kind: 'ref', areas: [{ sheet: base.sheet, top, left, bottom, right }] }
}

const INDIRECT_SHAPES = new Set(['ref', 'name', 'structured', 'binary', 'paren'])

function indirectShape(node: Node): boolean {
  if (!INDIRECT_SHAPES.has(node.type)) return false
  if (node.type === 'binary') return (node.op === ':' || node.op === ' ' || node.op === ',') && indirectShape(node.left) && indirectShape(node.right)
  if (node.type === 'paren') return indirectShape(node.expr)
  return true
}

const INDIRECT: OwnedFunction = (it, args, scope) => {
  if (args.length < 1 || args.length > 2) return Errors.VALUE
  const textValue = toText(it.toScalar(it.arg(args[0], scope)))
  if (isError(textValue)) return textValue
  let a1 = true
  if (args.length === 2) {
    const style = toBoolean(it.toScalar(it.arg(args[1], scope)))
    if (isError(style)) return style
    a1 = style
  }
  let text = textValue.trim()
  if (!text) return Errors.REF
  if (!a1) text = r1c1ToA1(text, it.row, it.col)
  const parsed = parseFormula(text)
  if (!parsed.ok || !indirectShape(parsed.ast)) return Errors.REF
  const value = it.evalName(parsed.ast)
  return isReference(value) ? value : Errors.REF
}

/** INDEX on one area or array, with one-based row/column (0 = all). */
function indexOne(it: Interpreter, source: Value, rowArg: Scalar, colArg: Scalar | undefined, areaArg: Scalar): Value {
  const date1904 = it.host.date1904
  let row = integer(rowArg, date1904, it.currentYear())
  if (isError(row)) return row
  let col: number | FormulaError | undefined = colArg === undefined ? undefined : integer(colArg, date1904, it.currentYear())
  if (isError(col)) return col
  const areaNumber = integer(areaArg, date1904, it.currentYear())
  if (isError(areaNumber)) return areaNumber
  if (row < 0 || (col !== undefined && col < 0)) return Errors.VALUE
  let rows: number
  let cols: number
  let area: Area | undefined
  let array: Matrix | undefined
  if (isReference(source)) {
    area = source.areas[areaNumber - 1]
    if (!area) return Errors.REF
    rows = areaRows(area)
    cols = areaCols(area)
  } else {
    if (areaNumber !== 1) return Errors.REF
    array = isMatrix(source) ? source : matrix(1, 1, [source as Scalar])
    rows = logicalSize(array).rows
    cols = logicalSize(array).cols
  }
  if (col === undefined) {
    if (rows === 1 && cols > 1) {
      col = row
      row = 0
    } else {
      col = cols === 1 ? 1 : 0
    }
  }
  if (row > rows || col > cols) return Errors.REF
  const top = row === 0 ? 0 : row - 1
  const bottom = row === 0 ? rows - 1 : row - 1
  const left = col === 0 ? 0 : col - 1
  const right = col === 0 ? cols - 1 : col - 1
  if (area) {
    return { kind: 'ref', areas: [{ sheet: area.sheet, top: area.top + top, left: area.left + left, bottom: area.top + bottom, right: area.left + right }] }
  }
  if (top === bottom && left === right) return matrixGet(array!, top, left)
  return rangeSlice(array!, top, left, bottom - top + 1, right - left + 1)
}

const INDEX: OwnedFunction = (it, args, scope) => {
  if (args.length < 2 || args.length > 4) return Errors.VALUE
  const saved = it.legacy
  it.legacy = false
  let source: Value | undefined
  try {
    source = it.arg(args[0], scope)
  } finally {
    it.legacy = saved
  }
  if (source === undefined) return Errors.VALUE
  if (isError(source)) return source
  if (isLambda(source)) return Errors.VALUE
  const rowValue = liftable(it, args[1], scope, 0)
  const colValue = args.length > 2 ? liftable(it, args[2], scope, 0) : undefined
  const areaValue = args.length > 3 ? it.toScalar(it.arg(args[3], scope) ?? 1) : 1
  if (isMatrix(rowValue) || isMatrix(colValue)) {
    const values: Liftable[] = colValue === undefined ? [rowValue] : [rowValue, colValue]
    return liftAll(values, ([r, c]) => it.elementResult(indexOne(it, source, r!, colValue === undefined ? undefined : c!, areaValue)))
  }
  return indexOne(it, source, rowValue, colValue as Scalar | undefined, areaValue)
}

const ISREF: OwnedFunction = (it, args, scope) => {
  if (args.length !== 1) return Errors.VALUE
  return isReference(it.arg(args[0], scope))
}

function formulaInfo(it: Interpreter, args: Args, scope: Scope | undefined): string | undefined | FormulaError {
  if (args.length !== 1) return Errors.VALUE
  const ref = referenceArg(it, args[0], scope)
  if (isError(ref)) return ref
  const area = ref.areas[0]!
  return it.host.formulaText(area.sheet, area.top, area.left)
}

const ISFORMULA: OwnedFunction = (it, args, scope) => {
  const text = formulaInfo(it, args, scope)
  return isError(text) ? text : text !== undefined
}

const FORMULATEXT: OwnedFunction = (it, args, scope) => {
  const text = formulaInfo(it, args, scope)
  return isError(text) ? text : (text ?? Errors.NA)
}

function addressText(it: Interpreter, area: Area): string {
  const address = `$${columnName(area.left)}$${area.top + 1}`
  if (area.sheet === it.sheet) return address
  return `${quoteSheetName(it.host.sheetName(area.sheet) ?? '')}!${address}`
}

const CELL: OwnedFunction = (it, args, scope) => {
  if (args.length < 1 || args.length > 2) return Errors.VALUE
  const info = toText(it.toScalar(it.arg(args[0], scope)))
  if (isError(info)) return info
  let area: Area = { sheet: it.sheet, top: it.row, left: it.col, bottom: it.row, right: it.col }
  if (args.length === 2) {
    const ref = referenceArg(it, args[1], scope)
    if (isError(ref)) return ref
    area = ref.areas[0]!
  }
  switch (info.trim().toLowerCase()) {
    case 'address':
      return addressText(it, area)
    case 'row':
      return area.top + 1
    case 'col':
      return area.left + 1
    case 'contents':
      return it.host.readCell(area.sheet, area.top, area.left)
    case 'type': {
      const value = it.host.readCell(area.sheet, area.top, area.left)
      return value === null ? 'b' : typeof value === 'string' ? 'l' : 'v'
    }
    case 'filename':
    case 'prefix':
      return ''
    case 'format':
      return 'G'
    case 'protect':
      return 1
    case 'width':
      return 8
    case 'color':
    case 'parentheses':
      return 0
    default:
      return Errors.VALUE
  }
}

const INFO: OwnedFunction = (it, args, scope) => {
  if (args.length !== 1) return Errors.VALUE
  const type = toText(it.toScalar(it.arg(args[0], scope)))
  if (isError(type)) return type
  switch (type.trim().toLowerCase()) {
    case 'numfile':
      return it.host.sheetCount()
    case 'recalc':
      return 'Automatic'
    case 'release':
      return '16.0'
    case 'system':
      return 'pcdos'
    case 'osversion':
      return 'Windows (64-bit) NT 10.00'
    case 'origin':
      return '$A:$A$1'
    case 'directory':
      return Errors.NA
    default:
      return Errors.VALUE
  }
}

const SHEET: OwnedFunction = (it, args, scope) => {
  if (args.length > 1) return Errors.VALUE
  if (!args.length || !args[0]) return it.sheet + 1
  const value = it.eval(args[0], scope)
  if (isError(value)) return value
  if (isReference(value)) return value.areas[0]!.sheet + 1
  const scalar = it.toScalar(value)
  if (typeof scalar !== 'string') return Errors.NA
  const index = it.host.sheetIndex(scalar)
  return index < 0 ? Errors.NA : index + 1
}

const SHEETS: OwnedFunction = (it, args, scope) => {
  if (args.length > 1) return Errors.VALUE
  if (!args.length || !args[0]) return it.host.sheetCount()
  const ref = referenceArg(it, args[0], scope)
  if (isError(ref)) return ref
  return new Set(ref.areas.map((area) => area.sheet)).size
}

export const OWNED_FUNCTIONS: ReadonlyMap<string, OwnedFunction> = new Map<string, OwnedFunction>([
  ['IF', IF],
  ['IFS', IFS],
  ['IFERROR', errorHandler(false)],
  ['IFNA', errorHandler(true)],
  ['SWITCH', SWITCH],
  ['CHOOSE', CHOOSE],
  ['LET', LET],
  ['LAMBDA', LAMBDA],
  ['ISOMITTED', ISOMITTED],
  ['MAP', MAP],
  ['REDUCE', reduceLike(false)],
  ['SCAN', reduceLike(true)],
  ['BYROW', byLine(true)],
  ['BYCOL', byLine(false)],
  ['MAKEARRAY', MAKEARRAY],
  ['ROW', rowOrColumn(true)],
  ['COLUMN', rowOrColumn(false)],
  ['ROWS', dimension(true)],
  ['COLUMNS', dimension(false)],
  ['AREAS', AREAS],
  ['OFFSET', OFFSET],
  ['INDIRECT', INDIRECT],
  ['INDEX', INDEX],
  ['ISREF', ISREF],
  ['ISFORMULA', ISFORMULA],
  ['FORMULATEXT', FORMULATEXT],
  ['CELL', CELL],
  ['INFO', INFO],
  ['SHEET', SHEET],
  ['SHEETS', SHEETS],
])

/**
 * Functions the evaluator implements. The function library should not define these; if it does,
 * the evaluator's version is used.
 */
export const EVALUATOR_FUNCTIONS: readonly string[] = [...OWNED_FUNCTIONS.keys()]

/** Evaluator functions that make a formula volatile. */
export const VOLATILE_EVALUATOR_FUNCTIONS: ReadonlySet<string> = new Set(['OFFSET', 'INDIRECT', 'CELL', 'INFO'])

/** Functions whose results are written with the `_xlfn.` prefix in files. */
export const XLFN_EVALUATOR_FUNCTIONS: ReadonlySet<string> = new Set(['IFS', 'IFNA', 'SWITCH', 'LET', 'LAMBDA', 'ISOMITTED', 'MAP', 'REDUCE', 'SCAN', 'BYROW', 'BYCOL', 'MAKEARRAY', 'ISFORMULA', 'FORMULATEXT', 'SHEET', 'SHEETS'])
