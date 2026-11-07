/**
 * The AST interpreter. It knows nothing about storage: cell contents, names, tables, and spills
 * come from an `EvalHost` (the engine), which also learns from every read which cells a formula
 * actually depends on.
 *
 * Recursion is bounded: the parser caps nesting, left-deep operator chains (`1+1+…+1`) are
 * evaluated iteratively, and LAMBDA/name recursion is capped at `MAX_CALL_DEPTH` (#NUM! beyond).
 */

import { minOf, maxOf } from '../../../collections.js'

import { broadcastRanges } from './ranges.js'
import { logicalSize } from './types.js'


import { serialToParts } from '../dates.js'
import { CalculationStopped, consumeWork } from './budget.js'
import { OWNED_FUNCTIONS } from './builtins.js'
import type { Node } from './parse.js'
import { structuredArea, type TableDefinition } from './tables.js'
import type { RefParts, StructuredRef } from './tokenize.js'
import {
  Errors,
  errorFromCode,
  isError,
  isLambda,
  isMatrix,
  isReference,
  matrix,
  type Area,
  type FormulaError,
  type FunctionContext,
  type FunctionSpec,
  type LambdaValue,
  type Matrix,
  type Reference,
  type Scalar,
  type Value,
} from './types.js'
import { binaryScalar, elementwise, mapValue, negate, percent, type ScalarOp } from './values.js'

/** How deep LAMBDA calls and defined-name evaluation may recurse. */
export const MAX_CALL_DEPTH = 1000

/** What the interpreter needs from the workbook. Sheets are addressed by current index. */
export interface EvalHost {
  readonly functions: ReadonlyMap<string, FunctionSpec>
  readonly date1904: boolean
  sheetCount(): number
  sheetName(index: number): string | undefined
  /** Index of a sheet by name (case-insensitive), or -1. */
  sheetIndex(name: string): number
  readCell(sheet: number, row: number, col: number): Scalar
  /** Contents may omit a uniform blank tail; logicalSize always retains the original bounds. */
  readArea(area: Area): Matrix
  /** The spill range anchored at a cell, if it has one (`A1#`). */
  spillArea(sheet: number, row: number, col: number): Area | undefined
  /** `=…` text of the formula in a cell (`{=…}` for legacy array formulas), if any. */
  formulaText(sheet: number, row: number, col: number): string | undefined
  /** A defined name visible from `sheet` (or from the sheet named by `qualifier`). */
  lookupName(name: string, qualifier: string | undefined, sheet: number): Node | FormulaError | undefined
  /** A table by name, or the table containing the cell when `name` is undefined. */
  table(name: string | undefined, sheet: number, row: number, col: number): TableDefinition | undefined
  /** NOW() as a serial, stable within one recalculation. */
  now(): number
  random(): number
}

export interface Binding {
  value: Value
  /** A LAMBDA parameter the caller left out (ISOMITTED). */
  omitted?: boolean
}

/** LET and LAMBDA variables. */
export class Scope {
  readonly vars = new Map<string, Binding>()
  constructor(readonly parent: Scope | undefined) {}

  lookup(name: string): Binding | undefined {
    return this.vars.get(name) ?? this.parent?.lookup(name)
  }
}

class DepthExceeded {}

type BinaryNode = Extract<Node, { type: 'binary' }>

/** The rectangle a reference token covers, normalized. */
export function refRect(ref: RefParts): { top: number; left: number; bottom: number; right: number } {
  return {
    top: Math.min(ref.row, ref.row2),
    left: Math.min(ref.col, ref.col2),
    bottom: Math.max(ref.row, ref.row2),
    right: Math.max(ref.col, ref.col2),
  }
}

export class Interpreter {
  /** Date coercion shares NOW's clock and local date, including fixed export snapshots. */
  currentYear(): number {
    return serialToParts(this.host.now(), this.host.date1904)?.year ?? 2000
  }

  /** The cell being calculated. */
  sheet = 0
  row = 0
  col = 0
  /**
   * Pre-dynamic-array semantics: a range where one value is expected is implicitly intersected
   * with the formula's row or column instead of producing an array.
   */
  legacy = false
  private callDepth = 0
  private snapRoot: Node | undefined
  readonly ctx: FunctionContext

  constructor(readonly host: EvalHost) {
    this.ctx = new Context(this)
  }

  /** Evaluates a whole formula for the cell at (sheet, row, col). Never throws. */
  run(ast: Node, sheet: number, row: number, col: number, legacy: boolean): Value {
    const saved = [this.sheet, this.row, this.col, this.legacy, this.callDepth, this.snapRoot] as const
    this.sheet = sheet
    this.row = row
    this.col = col
    this.legacy = legacy
    this.callDepth = 0
    this.snapRoot = ast.type === 'binary' && (ast.op === '+' || ast.op === '-') ? ast : undefined
    try {
      return this.eval(ast, undefined)
    } catch (error) {
      if (error instanceof CalculationStopped) throw error
      if (isError(error)) return error
      if (error instanceof DepthExceeded || error instanceof RangeError) return Errors.NUM
      return Errors.VALUE
    } finally {
      ;[this.sheet, this.row, this.col, this.legacy, this.callDepth, this.snapRoot] = saved
    }
  }

  eval(node: Node, scope: Scope | undefined): Value {
    consumeWork()
    switch (node.type) {
      case 'number':
        return Number.isFinite(node.value) ? node.value : Errors.NUM
      case 'string':
      case 'bool':
        return node.value
      case 'error':
        return errorFromCode(node.code) ?? Errors.NAME
      case 'array':
        return matrix(node.rows, node.cols, node.data)
      case 'ref':
        return this.reference(node.ref)
      case 'name':
        return this.name(node, scope)
      case 'structured':
        return this.structured(node.ref)
      case 'external':
        return Errors.REF
      case 'paren':
        return this.eval(node.expr, scope)
      case 'unary': {
        const value = this.eval(node.operand, scope)
        if (node.op === '+') return value
        if (node.op === '@') return this.implicitIntersection(value)
        return mapValue(this.operand(value), (x) => negate(x, this.host.date1904, this.currentYear()))
      }
      case 'postfix': {
        const value = this.eval(node.operand, scope)
        if (node.op === '%') return mapValue(this.operand(value), (x) => percent(x, this.host.date1904, this.currentYear()))
        return this.spill(value)
      }
      case 'binary':
        return this.binary(node, scope)
      case 'call':
        return this.call(node, scope)
      case 'invoke': {
        const callee = this.eval(node.callee, scope)
        if (isError(callee)) return callee
        if (!isLambda(callee)) return Errors.VALUE
        return this.invokeNodes(callee, node.args, scope)
      }
    }
  }

  /** Evaluates an argument slot; empty slots are undefined. */
  arg(node: Node | null | undefined, scope: Scope | undefined): Value | undefined {
    return node ? this.eval(node, scope) : undefined
  }

  childScope(scope: Scope | undefined): Scope {
    return new Scope(scope)
  }

  reference(ref: RefParts): Reference | FormulaError {
    let first = this.sheet
    let last = this.sheet
    if (ref.sheet) {
      first = this.host.sheetIndex(ref.sheet.sheet)
      last = ref.sheet.lastSheet === undefined ? first : this.host.sheetIndex(ref.sheet.lastSheet)
      if (first < 0 || last < 0) return Errors.REF
    }
    const rect = refRect(ref)
    const areas: Area[] = []
    for (let sheet = Math.min(first, last); sheet <= Math.max(first, last); sheet++) areas.push({ sheet, ...rect })
    return { kind: 'ref', areas }
  }

  private name(node: Extract<Node, { type: 'name' }>, scope: Scope | undefined): Value {
    if (!node.sheet && scope) {
      const binding = scope.lookup(node.name)
      if (binding) return binding.omitted ? null : binding.value
    }
    const definition = this.host.lookupName(node.name, node.sheet?.sheet, this.sheet)
    if (definition !== undefined) return isError(definition) ? definition : this.evalName(definition)
    if (!node.sheet) {
      const table = this.host.table(node.name, this.sheet, this.row, this.col)
      if (table) return this.structuredFor(table, { items: [] })
    }
    return Errors.NAME
  }

  /** Evaluates a defined name's formula in the current cell's context. */
  evalName(ast: Node): Value {
    if (++this.callDepth > MAX_CALL_DEPTH) {
      this.callDepth--
      throw new DepthExceeded()
    }
    try {
      return this.eval(ast, undefined)
    } finally {
      this.callDepth--
    }
  }

  private structured(ref: StructuredRef): Value {
    const table = this.host.table(ref.table, this.sheet, this.row, this.col)
    if (!table) return Errors.REF
    return this.structuredFor(table, ref)
  }

  private structuredFor(table: TableDefinition, ref: StructuredRef): Value {
    const area = structuredArea(table, ref, this.row)
    return isError(area) ? area : { kind: 'ref', areas: [area] }
  }

  private spill(value: Value): Value {
    if (isError(value)) return value
    if (!isReference(value) || value.areas.length !== 1) return Errors.REF
    const area = value.areas[0]!
    if (area.top !== area.bottom || area.left !== area.right) return Errors.REF
    const spill = this.host.spillArea(area.sheet, area.top, area.left)
    return spill ? { kind: 'ref', areas: [spill] } : Errors.REF
  }

  /** `@`: a range becomes the cell in the formula's row or column; an array its first element. */
  implicitIntersection(value: Value): Value {
    if (isReference(value)) return this.intersectReference(value)
    if (isMatrix(value)) return value.rows && value.cols ? (value.data[0] ?? null) : Errors.VALUE
    return value
  }

  intersectReference(ref: Reference): Reference | FormulaError {
    if (ref.areas.length !== 1) return Errors.VALUE
    const area = ref.areas[0]!
    if (area.top === area.bottom && area.left === area.right) return ref
    let row: number
    let col: number
    if (area.left === area.right) {
      if (this.row < area.top || this.row > area.bottom) return Errors.VALUE
      row = this.row
      col = area.left
    } else if (area.top === area.bottom) {
      if (this.col < area.left || this.col > area.right) return Errors.VALUE
      row = area.top
      col = this.col
    } else {
      return Errors.VALUE
    }
    return { kind: 'ref', areas: [{ sheet: area.sheet, top: row, left: col, bottom: row, right: col }] }
  }

  /**
   * A value as an operator operand: a one-cell reference is its value, a larger one an array (or,
   * in legacy mode, the implicitly intersected cell).
   */
  operand(value: Value): Scalar | Matrix {
    if (isReference(value)) {
      if (value.areas.length !== 1) return Errors.VALUE
      const area = value.areas[0]!
      if (area.top === area.bottom && area.left === area.right) return this.host.readCell(area.sheet, area.top, area.left)
      if (this.legacy) {
        const cell = this.intersectReference(value)
        if (isError(cell)) return cell
        const only = cell.areas[0]!
        return this.host.readCell(only.sheet, only.top, only.left)
      }
      return this.host.readArea(area)
    }
    if (isLambda(value)) return Errors.CALC
    return value
  }

  /** A `scalar`-kind argument: like `operand`, with 1×1 arrays unwrapped. Lambdas pass through. */
  scalarArg(value: Value): Scalar | Matrix | LambdaValue {
    if (isLambda(value)) return value
    const operand = this.operand(value)
    if (isMatrix(operand) && logicalSize(operand).rows === 1 && logicalSize(operand).cols === 1) return operand.data[0] ?? null
    return operand
  }

  /** Exactly one scalar: references are implicitly intersected, arrays give their first element. */
  toScalar(value: Value | undefined): Scalar {
    if (value === undefined) return null
    if (isReference(value)) {
      const cell = this.intersectReference(value)
      if (isError(cell)) return cell
      const area = cell.areas[0]!
      return this.host.readCell(area.sheet, area.top, area.left)
    }
    if (isMatrix(value)) return value.rows && value.cols ? (value.data[0] ?? null) : Errors.VALUE
    if (isLambda(value)) return Errors.CALC
    return value
  }

  /** One element of a lifted or mapped result: nested arrays are #CALC!. */
  elementResult(value: Value): Scalar {
    if (isReference(value)) {
      if (value.areas.length !== 1) return Errors.CALC
      const area = value.areas[0]!
      if (area.top !== area.bottom || area.left !== area.right) return Errors.CALC
      return this.host.readCell(area.sheet, area.top, area.left)
    }
    if (isMatrix(value)) return logicalSize(value).rows === 1 && logicalSize(value).cols === 1 ? (value.data[0] ?? null) : Errors.CALC
    if (isLambda(value)) return Errors.CALC
    return value
  }

  private binary(node: BinaryNode, scope: Scope | undefined): Value {
    const spine: BinaryNode[] = []
    let leftmost: Node = node
    while (leftmost.type === 'binary') {
      spine.push(leftmost)
      leftmost = leftmost.left
    }
    let acc = this.eval(leftmost, scope)
    for (let i = spine.length - 1; i >= 0; i--) {
      const step = spine[i]!
      acc = this.applyBinary(step.op, acc, this.eval(step.right, scope), step === this.snapRoot)
    }
    return acc
  }

  private applyBinary(op: BinaryNode['op'], a: Value, b: Value, snap: boolean): Value {
    if (op === ':' || op === ' ' || op === ',') return this.referenceOp(op, a, b)
    const x = this.operand(a)
    const y = this.operand(b)
    const date1904 = this.host.date1904
    return elementwise(x, y, (p, q) => binaryScalar(op as ScalarOp, p, q, date1904, snap, this.currentYear()))
  }

  private referenceOp(op: ':' | ' ' | ',', a: Value, b: Value): Value {
    if (isError(a)) return a
    if (isError(b)) return b
    if (!isReference(a) || !isReference(b)) return Errors.VALUE
    if (op === ',') return { kind: 'ref', areas: [...a.areas, ...b.areas] }
    if (op === ':') {
      const areas = [...a.areas, ...b.areas]
      const sheet = areas[0]!.sheet
      if (areas.some((area) => area.sheet !== sheet)) return Errors.VALUE
      return {
        kind: 'ref',
        areas: [
          {
            sheet,
            top: minOf(areas.map((area) => area.top)),
            left: minOf(areas.map((area) => area.left)),
            bottom: maxOf(areas.map((area) => area.bottom)),
            right: maxOf(areas.map((area) => area.right)),
          },
        ],
      }
    }
    const areas: Area[] = []
    for (const x of a.areas) {
      for (const y of b.areas) {
        consumeWork()
        if (x.sheet !== y.sheet) continue
        const top = Math.max(x.top, y.top)
        const left = Math.max(x.left, y.left)
        const bottom = Math.min(x.bottom, y.bottom)
        const right = Math.min(x.right, y.right)
        if (top <= bottom && left <= right) areas.push({ sheet: x.sheet, top, left, bottom, right })
      }
    }
    return areas.length ? { kind: 'ref', areas } : Errors.NULL
  }

  private call(node: Extract<Node, { type: 'call' }>, scope: Scope | undefined): Value {
    const { name } = node
    if (scope && !node.sheet) {
      const binding = scope.lookup(name)
      if (binding) {
        if (isLambda(binding.value)) return this.invokeNodes(binding.value, node.args, scope)
        return isError(binding.value) ? binding.value : Errors.VALUE
      }
    }
    if (!node.sheet) {
      const owned = OWNED_FUNCTIONS.get(name)
      if (owned) return owned(this, node.args, scope)
      const spec = this.host.functions.get(name)
      if (spec) return this.callSpec(spec, node.args, scope)
    }
    const definition = this.host.lookupName(name, node.sheet?.sheet, this.sheet)
    if (definition !== undefined) {
      if (isError(definition)) return definition
      const value = this.evalName(definition)
      if (isLambda(value)) return this.invokeNodes(value, node.args, scope)
      return isError(value) ? value : Errors.VALUE
    }
    return Errors.NAME
  }

  private callSpec(spec: FunctionSpec, args: (Node | null)[], scope: Scope | undefined): Value {
    const count = args.length
    if (count < spec.minArgs || count > spec.maxArgs) return Errors.VALUE
    const values: (Value | undefined)[] = new Array(count)
    let lift = false
    for (let i = 0; i < count; i++) {
      const arg = args[i]
      if (!arg) {
        values[i] = undefined
        continue
      }
      const kind = spec.args?.length ? spec.args[Math.min(i, spec.args.length - 1)] : 'scalar'
      if (kind === 'any') {
        // Array-accepting arguments are evaluated as arrays even in legacy formulas (SUMPRODUCT).
        const saved = this.legacy
        this.legacy = false
        try {
          values[i] = this.eval(arg, scope)
        } finally {
          this.legacy = saved
        }
        continue
      }
      const value = this.scalarArg(this.eval(arg, scope))
      if (isMatrix(value)) lift = true
      values[i] = value
    }
    if (!lift) return this.apply(spec, values)
    return this.lift(values, (row) => this.apply(spec, row))
  }

  /** Runs `fn` once per element of the array arguments, broadcasting like Excel. */
  lift(values: (Value | undefined)[], fn: (args: (Value | undefined)[]) => Value): Matrix {
    const matrices = values.map((value) => isMatrix(value) ? value : null)
    return broadcastRanges(matrices, (cells) => this.elementResult(fn(values.map((value, i) => matrices[i] ? cells[i] : value))))
  }

  private apply(spec: FunctionSpec, values: (Value | undefined)[]): Value {
    try {
      consumeWork()
      const result = spec.fn(this.ctx, values)
      return result === undefined ? Errors.VALUE : result
    } catch (error) {
      if (error instanceof CalculationStopped) throw error
      if (isError(error)) return error
      if (error instanceof DepthExceeded || error instanceof RangeError) throw error
      return Errors.VALUE
    }
  }

  invokeNodes(lambda: LambdaValue, args: (Node | null)[], scope: Scope | undefined): Value {
    return this.invoke(
      lambda,
      args.map((arg) => this.arg(arg, scope)),
    )
  }

  /** Calls a LAMBDA. Missing trailing arguments are omitted (ISOMITTED is TRUE, the value blank). */
  invoke(lambda: LambdaValue, args: (Value | undefined)[]): Value {
    if (args.length > lambda.params.length) return Errors.VALUE
    if (++this.callDepth > MAX_CALL_DEPTH) {
      this.callDepth--
      throw new DepthExceeded()
    }
    try {
      const scope = new Scope(lambda.closure instanceof Scope ? lambda.closure : undefined)
      lambda.params.forEach((param, i) => {
        const value = args[i]
        scope.vars.set(param, value === undefined ? { value: null, omitted: true } : { value })
      })
      return this.eval(lambda.body as Node, scope)
    } finally {
      this.callDepth--
    }
  }
}

/** The `FunctionContext` handed to library functions; reads the interpreter's current cell. */
class Context implements FunctionContext {
  constructor(private readonly it: Interpreter) {}
  get date1904(): boolean {
    return this.it.host.date1904
  }
  get sheet(): number {
    return this.it.sheet
  }
  get row(): number {
    return this.it.row
  }
  get col(): number {
    return this.it.col
  }
  now(): number {
    return this.it.host.now()
  }
  random(): number {
    return this.it.host.random()
  }
  resolve(ref: Reference): Matrix {
    return ref.areas.length ? this.it.host.readArea(ref.areas[0]!) : matrix(1, 1, [Errors.REF])
  }
  resolveAreas(ref: Reference): Matrix[] {
    return ref.areas.map((area) => this.it.host.readArea(area))
  }
  call(lambda: LambdaValue, args: Value[]): Value {
    return this.it.invoke(lambda, args)
  }
}
