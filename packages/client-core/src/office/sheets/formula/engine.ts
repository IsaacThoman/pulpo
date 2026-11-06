/**
 * The calculation engine: cell storage, the dependency graph, incremental recalculation, dynamic
 * array spills, legacy array formulas, defined names, and tables. Everything is index-based: sheets
 * by position, rows and columns zero-based.
 *
 * Dependencies. Each formula's references are found statically when it is set. Single cells
 * become entries in a per-sheet map; anything larger goes into a `RangeIndex` once per distinct
 * rectangle, so `SUM(A:A)` is one entry, not a million edges. References only known at run time
 * (`INDEX(A:A,5):B10`, `OFFSET`, `INDIRECT`, names that are formulas) are recorded from what the
 * evaluation actually read and kept as extra "dynamic" dependencies.
 *
 * Recalculation. Changed cells and everything downstream of them (plus volatile formulas) are
 * marked pending; Tarjan's algorithm orders them and finds cycles; evaluation then runs in that
 * order. If an evaluation reads a pending cell the static order did not foresee, it is retried
 * after that cell (an explicit stack, never recursion), so chains of any length are safe.
 * Circular references evaluate to 0 (or iterate, if enabled) and are reported by `isCircular`.
 */

import { MAX_COLS, MAX_ROWS } from '../address.js'
import { MAX_EXPANDED_CELLS } from '../limits.js'
import { epochMsToSerial } from '../dates.js'
import { calculationBudget, CalculationStopped, consumeWork } from './budget.js'
import { OWNED_FUNCTIONS, VOLATILE_EVALUATOR_FUNCTIONS } from './builtins.js'
import { Interpreter, refRect, type EvalHost } from './evaluate.js'
import { parseFormula, type Node, type ParseError } from './parse.js'
import { RangeIndex, newQueryToken, type Rect } from './range-index.js'
import { structuredArea, tableAt, type TableDefinition } from './tables.js'
import { logicalSize, matrixGet, checkArraySize, MAX_ARRAY_CELLS, Errors, isError, isLambda, isMatrix, isReference, matrix, type Area, type FunctionSpec, type Matrix, type Scalar, type Value } from './types.js'
import { broadcastAt, sameScalar } from './values.js'

export interface FormulaEngineOptions {
  /** The function library, keyed by upper-case name. Evaluator-owned functions take precedence. */
  functions: ReadonlyMap<string, FunctionSpec>
  /** The workbook uses the 1904 date system. */
  date1904?: boolean
  /** Current time in ms since the Unix epoch; NOW() shows it in the runtime's local time zone. */
  now?: () => number
  /** Fixed snapshots supply their author’s offset; live calculations use the host timezone. */
  timezoneOffset?: number
  /** Random numbers in [0, 1) for RAND and friends. */
  random?: () => number
  /** Iterative calculation for circular references (Excel's File → Options → Formulas). */
  iterative?: { maxIterations: number; maxChange: number }
  /** A smaller allowance may be used by hosts with tighter latency constraints. */
  maxWork?: number
}

export type CellInput =
  | { value: Scalar }
  | {
      /** Formula text without the leading `=`. */
      formula: string
      /** A legacy (Ctrl+Shift+Enter) array formula filling this many rows and columns from this cell. */
      array?: { rows: number; cols: number }
      /** The imported formula must retain its cached result without evaluation. */
      unsupported?: boolean
      /**
       * The value Excel saved for this formula. The cell counts as already calculated: it keeps this
       * value until something it depends on changes, it is volatile, or a full recalc runs, and
       * formulas the engine cannot calculate (unknown functions, external references, unparsable
       * text) keep it even then. Pass a Matrix for a spilled or array formula's whole result; do not
       * also set the spilled cells as values, or they will block the spill.
       */
      cached?: Scalar | Matrix
      /**
       * A formula from pre-dynamic-array Excel (no dynamic-array flag in the file): a range where a
       * single value is expected is implicitly intersected, and the result never spills.
       */
      legacy?: boolean
    }
  | undefined

export interface CellPosition {
  sheet: number
  row: number
  col: number
}

export interface RecalcOptions {
  /** Recalculate every formula, not just the ones affected by changes. */
  full?: boolean
  /**
   * Cells with a cached value (from `setCell`) for which this returns true keep that value instead
   * of being calculated (e.g. data-table formulas). Unsupported formulas always keep theirs.
   */
  keepCachedFor?: (sheet: number, row: number, col: number) => boolean
}

export interface RecalcResult {
  /** Cells whose value changed, spilled cells included. */
  changed: CellPosition[]
  stoppedEarly: boolean
}

const CLEAN = 0
const PENDING = 1
const ITERATING = 2

/** How often a cell may be recalculated within one recalc because spills moved under it. */
const MAX_REEVALUATIONS = 16
/** How often one evaluation may be restarted because it read a cell that was not ready yet. */
const MAX_ATTEMPTS = 1000
/** Area reads at least this large are cached within one recalc. */
const AREA_CACHE_MIN_CELLS = 256
/** Areas larger than this are trimmed to the used range when read. */
const MAX_AREA_CELLS = MAX_ARRAY_CELLS

interface Dep extends Rect {
  sheet: SheetData
}

interface FormulaInfo {
  text: string
  ast: Node | undefined
  parseError: ParseError | undefined
  legacy: boolean
  array: { rows: number; cols: number } | undefined
  volatile: boolean
  unsupported?: boolean
  unknownFunction: boolean
  externalRef: boolean
  usesTables: boolean
  names: Set<string>
  deps: Dep[]
  /** Keys of the single-cell static dependencies, for the "was this read foreseen?" check. */
  cellKeys: Set<number>
  rangeDeps: Dep[]
  dynamicDeps: Dep[]
}

interface Spill {
  rows: number
  cols: number
  data: Matrix
  /** A legacy array formula's fixed range (never blocked, never resized). */
  fixed: boolean
}

interface NameDefinition {
  name: string
  text: string
  ast: Node | undefined
  scope: SheetData | undefined
}

interface TableEntry {
  def: TableDefinition
  sheet: SheetData
}

class Cell {
  value: Scalar = null
  formula: FormulaInfo | undefined
  spill: Spill | undefined
  /** The rectangle a #SPILL! formula wanted. */
  blocked: Rect | undefined
  /** The value came from `setCell(..., { cached })` and has not been recalculated since. */
  cached = false
  circular = false
  // Recalculation state.
  state = CLEAN
  epoch = 0
  commits = 0
  attempts = 0
  onStack = false
  stackPos = 0
  selfLoop = false
  tIndex = -1
  tLow = 0
  tOn = false

  constructor(
    readonly sheet: SheetData,
    readonly row: number,
    readonly col: number,
  ) {}
}

class SpillIndex {
  private readonly rects = new Map<Cell, Rect>()
  private readonly blocks = new Map<number, Set<Cell>>()

  get size(): number {
    return this.rects.size
  }

  add(cell: Cell, rect: Rect): void {
    this.rects.set(cell, rect)
    for (let block = rect.top >> 6; block <= rect.bottom >> 6; block++) {
      let set = this.blocks.get(block)
      if (!set) this.blocks.set(block, (set = new Set()))
      set.add(cell)
    }
  }

  remove(cell: Cell): void {
    const rect = this.rects.get(cell)
    if (!rect) return
    this.rects.delete(cell)
    for (let block = rect.top >> 6; block <= rect.bottom >> 6; block++) {
      const set = this.blocks.get(block)
      if (!set) continue
      set.delete(cell)
      if (!set.size) this.blocks.delete(block)
    }
  }

  ownerAt(row: number, col: number): Cell | undefined {
    const set = this.blocks.get(row >> 6)
    if (!set) return undefined
    for (const cell of set) {
      const rect = this.rects.get(cell)!
      if (row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right) return cell
    }
    return undefined
  }

  intersecting(rect: Rect, budgeted = false): Cell[] {
    const out = new Set<Cell>()
    const test = (cell: Cell, other: Rect) => {
      if (budgeted) consumeWork()
      if (other.left <= rect.right && other.right >= rect.left && other.top <= rect.bottom && other.bottom >= rect.top) out.add(cell)
    }
    const first = rect.top >> 6
    const last = rect.bottom >> 6
    if (last - first + 1 > this.blocks.size) {
      for (const [cell, other] of this.rects) test(cell, other)
    } else {
      for (let block = first; block <= last; block++) {
        const set = this.blocks.get(block)
        if (set) for (const cell of set) test(cell, this.rects.get(cell)!)
      }
    }
    return [...out]
  }
}

class SheetData {
  readonly columns: (Cell | undefined)[][] = []
  readonly cellDeps = new Map<number, Set<Cell>>()
  readonly ranges = new RangeIndex<Cell>()
  readonly spills = new SpillIndex()
  readonly blocked = new Set<Cell>()
  maxRow = -1
  maxCol = -1
  /** Pending formula cells by column, sorted by row; built per recalc for ordering. */
  pendingIndex: Map<number, Cell[]> | undefined

  constructor(
    readonly id: number,
    public index: number,
    public name: string,
  ) {}

  get(row: number, col: number): Cell | undefined {
    return this.columns[col]?.[row]
  }

  ensure(row: number, col: number): Cell {
    let column = this.columns[col]
    if (!column) this.columns[col] = column = []
    let cell = column[row]
    if (!cell) {
      column[row] = cell = new Cell(this, row, col)
      this.grow(row, col)
    }
    return cell
  }

  delete(row: number, col: number): void {
    const column = this.columns[col]
    if (column && column[row]) column[row] = undefined
  }

  grow(row: number, col: number): void {
    if (row > this.maxRow) this.maxRow = row
    if (col > this.maxCol) this.maxCol = col
  }
}

interface CalcState {
  epoch: number
  current: Cell | undefined
  needs: Cell[]
  reads: Dep[]
  pending: Cell[]
  worklist: Cell[]
  changed: Map<string, CellPosition>
  keep: RecalcOptions['keepCachedFor']
  now: number | undefined
  /**
   * Large areas already read in this recalc that contained no pending formulas, so their contents
   * cannot change until something is re-dirtied (which clears the cache).
   */
  areas: Map<string, Matrix>
  /** Iterating a circular reference: values change without going through `pend`, so no caching. */
  iterating: boolean
}

interface Finalized {
  value: Scalar
  spill?: Matrix
}

/** For these functions, the first N arguments are only used for their address, not their contents. */
const ADDRESS_ONLY_ARGS = new Map<string, number>([
  ['ROW', 1],
  ['COLUMN', 1],
  ['ROWS', 1],
  ['COLUMNS', 1],
  ['AREAS', 1],
  ['ISREF', 1],
  ['SHEET', 1],
  ['SHEETS', 1],
  ['OFFSET', 1],
])

/** A reference written directly (not computed), so it can be skipped as a dependency. */
function isPureReference(node: Node): boolean {
  if (node.type === 'ref' || node.type === 'structured') return true
  if (node.type === 'paren') return isPureReference(node.expr)
  if (node.type === 'binary' && (node.op === ':' || node.op === ' ' || node.op === ',')) return isPureReference(node.left) && isPureReference(node.right)
  return false
}

function cellKey(row: number, col: number): number {
  return row * MAX_COLS + col
}

function positionOf(cell: Cell): Dep {
  return { sheet: cell.sheet, top: cell.row, left: cell.col, bottom: cell.row, right: cell.col }
}

function spillRect(cell: Cell, spill: Spill): Rect {
  return { top: cell.row, left: cell.col, bottom: cell.row + spill.rows - 1, right: cell.col + spill.cols - 1 }
}

function contains(outer: Rect, inner: Rect): boolean {
  return outer.top <= inner.top && outer.left <= inner.left && outer.bottom >= inner.bottom && outer.right >= inner.right
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom
}

function isSingle(rect: Rect): boolean {
  return rect.top === rect.bottom && rect.left === rect.right
}

function spillElement(owner: Cell, row: number, col: number): Scalar {
  const spill = owner.spill!
  return matrixGet(spill.data, row - owner.row, col - owner.col)
}

function zeroBlanks(value: Matrix): Matrix {
  return { ...value, data: value.data.map((x) => x ?? 0), ...(value.logicalRows !== undefined || value.logicalCols !== undefined ? { omittedValue: value.omittedValue ?? 0 } : {}) }
}

export class FormulaEngine {
  private readonly functions: Map<string, FunctionSpec>
  private readonly date1904: boolean
  private readonly interpreter: Interpreter
  private readonly host: EvalHost
  private sheets: SheetData[] = []
  private sheetsByName = new Map<string, SheetData>()
  private nextSheetId = 1
  private readonly names = new Map<string, NameDefinition>()
  private readonly nameUsers = new Map<string, Set<Cell>>()
  private tables: TableEntry[] = []
  private tablesByName = new Map<string, TableEntry>()
  private readonly tableUsers = new Set<Cell>()
  private readonly formulaCells = new Set<Cell>()
  private readonly volatileCells = new Set<Cell>()
  private readonly dirty = new Set<Cell>()
  private changedRects: Dep[] = []
  private calc: CalcState | undefined
  private epoch = 0

  constructor(private readonly options: FormulaEngineOptions) {
    this.functions = new Map([...options.functions].map(([name, spec]) => [name.toUpperCase(), spec]))
    this.date1904 = options.date1904 ?? false
    this.host = this.createHost()
    this.interpreter = new Interpreter(this.host)
  }

  // -------------------------------------------------------------------------------------------
  // Workbook structure

  /**
   * Sets the sheet list; order is sheet index. Sheets keep their cells across calls when matched by
   * name (so reordering moves data with the sheet); an unmatched new name at the position of an
   * unmatched old sheet is a rename of it. Sheets that disappear are dropped. Every formula is
   * re-resolved, so `Old!A1` becomes #REF! after a rename and `New!A1` starts working.
   */
  setSheets(names: string[]): void {
    const old = this.sheets
    const byName = new Map<string, SheetData>()
    for (const sheet of old) if (!byName.has(sheet.name.toUpperCase())) byName.set(sheet.name.toUpperCase(), sheet)
    const kept = new Set<SheetData>()
    const next: (SheetData | undefined)[] = names.map((name) => {
      const sheet = byName.get(name.toUpperCase())
      if (!sheet || kept.has(sheet)) return undefined
      kept.add(sheet)
      return sheet
    })
    next.forEach((sheet, i) => {
      const candidate = old[i]
      if (!sheet && candidate && !kept.has(candidate)) {
        kept.add(candidate)
        next[i] = candidate
      }
    })
    this.sheets = next.map((sheet, i) => {
      const result = sheet ?? new SheetData(this.nextSheetId++, i, names[i]!)
      result.index = i
      result.name = names[i]!
      return result
    })
    this.sheetsByName = new Map()
    for (const sheet of this.sheets) if (!this.sheetsByName.has(sheet.name.toUpperCase())) this.sheetsByName.set(sheet.name.toUpperCase(), sheet)
    for (const sheet of old) if (!kept.has(sheet)) this.dropSheet(sheet)
    for (const [key, definition] of this.names) if (definition.scope && !kept.has(definition.scope)) this.names.delete(key)
    this.tables = this.tables.filter((entry) => kept.has(entry.sheet))
    for (const entry of this.tables) entry.def.sheet = entry.sheet.index
    this.tablesByName = new Map(this.tables.map((entry) => [entry.def.name.toUpperCase(), entry]))
    for (const cell of [...this.formulaCells]) {
      this.bind(cell)
      this.dirty.add(cell)
    }
  }

  get sheetNames(): string[] {
    return this.sheets.map((sheet) => sheet.name)
  }

  /** Sets or clears (`undefined`) a cell. Formula text has no leading `=`. */
  setCell(sheetIndex: number, row: number, col: number, input: CellInput): void {
    const sheet = this.sheetAt(sheetIndex)
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) {
      throw new RangeError(`Cell (${row}, ${col}) is outside the grid`)
    }
    let cell = sheet.get(row, col)
    const existed = cell !== undefined
    if (cell?.formula) this.removeFormula(cell)
    const position: Dep = { sheet, top: row, left: col, bottom: row, right: col }
    if (input === undefined || ('value' in input && (input.value === null || input.value === undefined))) {
      if (cell) {
        sheet.delete(row, col)
        this.changedRects.push(position)
        this.wakeBlocked(sheet, position)
      }
      return
    }
    if (!cell) cell = sheet.ensure(row, col)
    cell.circular = false
    cell.cached = false
    if ('value' in input) {
      cell.value = input.value
      this.changedRects.push(position)
      this.dirtySpillOwner(cell)
      return
    }
    const text = input.formula.startsWith('=') ? input.formula.slice(1) : input.formula
    const parsed = parseFormula(text)
    const array = input.array
    cell.formula = {
      text,
      unsupported: input.unsupported,
      ast: parsed.ok ? parsed.ast : undefined,
      parseError: parsed.ok ? undefined : parsed.error,
      legacy: input.legacy === true,
      array:
        array && Number.isInteger(array.rows) && Number.isInteger(array.cols) && array.rows >= 1 && array.cols >= 1
          ? { rows: Math.min(array.rows, MAX_ROWS - row), cols: Math.min(array.cols, MAX_COLS - col) }
          : undefined,
      volatile: false,
      unknownFunction: false,
      externalRef: false,
      usesTables: false,
      names: new Set(),
      deps: [],
      cellKeys: new Set(),
      rangeDeps: [],
      dynamicDeps: [],
    }
    this.formulaCells.add(cell)
    this.bind(cell)
    this.dirtySpillOwner(cell)
    if (input.cached !== undefined) {
      this.seedCached(cell, input.cached)
      if (existed) this.changedRects.push(position)
    } else {
      cell.value = null
      this.dirty.add(cell)
      this.changedRects.push(position)
    }
  }

  /**
   * Treats everything set so far as calculated: after loading a workbook with cached values, call
   * this so the first edit only recalculates what that edit affects. Formulas set without a cached
   * value stay pending.
   */
  markClean(): void {
    this.changedRects = []
  }

  /**
   * Defines (or with `undefined`, removes) a name, case-insensitively, for the whole workbook or
   * for one sheet. The formula has no leading `=`; it may be a reference, a constant, any formula,
   * or a LAMBDA (which formulas can then call by name).
   */
  setName(name: string, formula: string | undefined, scopeSheet?: number): void {
    const upper = name.toUpperCase()
    const scope = scopeSheet === undefined ? undefined : this.sheetAt(scopeSheet)
    const key = this.nameKey(scope, upper)
    if (formula === undefined) {
      this.names.delete(key)
    } else {
      const text = formula.startsWith('=') ? formula.slice(1) : formula
      const parsed = parseFormula(text)
      this.names.set(key, { name, text, ast: parsed.ok ? parsed.ast : undefined, scope })
    }
    this.rebindUsers([upper])
  }

  /** Replaces all table definitions (for structured references). */
  setTables(tables: TableDefinition[]): void {
    const affected = new Set<Cell>(this.tableUsers)
    const names = [...this.tables.map((entry) => entry.def.name), ...tables.map((table) => table.name)].map((name) => name.toUpperCase())
    for (const name of names) for (const cell of this.nameUsers.get(name) ?? []) affected.add(cell)
    this.tables = tables.map((table) => ({ def: { ...table, columns: [...table.columns] }, sheet: this.sheetAt(table.sheet) }))
    this.tablesByName = new Map(this.tables.map((entry) => [entry.def.name.toUpperCase(), entry]))
    for (const cell of affected) {
      if (!cell.formula) continue
      this.bind(cell)
      this.dirty.add(cell)
    }
  }

  // -------------------------------------------------------------------------------------------
  // Reading

  /** The cell's value, including values spilled into it by a dynamic array or array formula. */
  getValue(sheetIndex: number, row: number, col: number): Scalar {
    const sheet = this.sheets[sheetIndex]
    if (!sheet) return null
    return this.cellValue(sheet, row, col, false)
  }

  /** Size of the dynamic-array spill anchored at this cell, if it spills. */
  getSpill(sheetIndex: number, row: number, col: number): { rows: number; cols: number } | undefined {
    const spill = this.sheets[sheetIndex]?.get(row, col)?.spill
    return spill && !spill.fixed ? { rows: spill.rows, cols: spill.cols } : undefined
  }

  /** The anchor of the spill or legacy array range covering a cell (the cell itself for anchors). */
  getSpillAnchor(sheetIndex: number, row: number, col: number): { row: number; col: number; array: boolean } | undefined {
    const owner = this.sheets[sheetIndex]?.spills.ownerAt(row, col)
    return owner ? { row: owner.row, col: owner.col, array: owner.spill!.fixed } : undefined
  }

  /** The cell's formula text, without `=`. */
  getFormula(sheetIndex: number, row: number, col: number): string | undefined {
    return this.sheets[sheetIndex]?.get(row, col)?.formula?.text
  }

  /** The formula could not be parsed (it shows #NAME? unless it has a cached value). */
  getParseError(sheetIndex: number, row: number, col: number): ParseError | undefined {
    return this.sheets[sheetIndex]?.get(row, col)?.formula?.parseError
  }

  /** The cell is part of a circular reference (as of the last recalc). */
  isCircular(sheetIndex: number, row: number, col: number): boolean {
    return this.sheets[sheetIndex]?.get(row, col)?.circular ?? false
  }

  /** Every cell that was part of a circular reference in the last recalc. */
  circularCells(): CellPosition[] {
    return [...this.formulaCells].filter((cell) => cell.circular).map((cell) => ({ sheet: cell.sheet.index, row: cell.row, col: cell.col }))
  }

  /** The formula calls a function that neither the evaluator nor the registry knows. */
  usesUnknownFunction(sheetIndex: number, row: number, col: number): boolean {
    return this.sheets[sheetIndex]?.get(row, col)?.formula?.unknownFunction ?? false
  }

  /** The formula refers to another workbook. */
  usesExternalReference(sheetIndex: number, row: number, col: number): boolean {
    return this.sheets[sheetIndex]?.get(row, col)?.formula?.externalRef ?? false
  }

  /**
   * The engine cannot calculate this formula faithfully (unknown function, external reference, or
   * unparsable text); it keeps its cached value if it has one.
   */
  isUnsupported(sheetIndex: number, row: number, col: number): boolean {
    const formula = this.sheets[sheetIndex]?.get(row, col)?.formula
    return formula ? this.unsupported(formula) : false
  }

  /** The cell still shows the cached value it was loaded with. */
  hasCachedValue(sheetIndex: number, row: number, col: number): boolean {
    return this.sheets[sheetIndex]?.get(row, col)?.cached ?? false
  }

  /** The areas a formula depends on (static references plus those seen at run time). */
  precedents(sheetIndex: number, row: number, col: number): Area[] {
    const formula = this.sheets[sheetIndex]?.get(row, col)?.formula
    if (!formula) return []
    return [...formula.deps, ...formula.dynamicDeps].map((dep) => ({ sheet: dep.sheet.index, top: dep.top, left: dep.left, bottom: dep.bottom, right: dep.right }))
  }

  /** Formula cells that directly depend on a cell. */
  dependents(sheetIndex: number, row: number, col: number): CellPosition[] {
    const sheet = this.sheets[sheetIndex]
    if (!sheet) return []
    const out = new Set<Cell>()
    this.dependentsOf({ sheet, top: row, left: col, bottom: row, right: col }, newQueryToken(), (cell) => out.add(cell))
    return [...out].map((cell) => ({ sheet: cell.sheet.index, row: cell.row, col: cell.col }))
  }

  /** Size of the dependency graph: single-cell edges and distinct range entries, across sheets. */
  dependencyStats(): { formulas: number; cellEdges: number; rangeEntries: number } {
    let cellEdges = 0
    let rangeEntries = 0
    for (const sheet of this.sheets) {
      for (const set of sheet.cellDeps.values()) cellEdges += set.size
      rangeEntries += sheet.ranges.size
    }
    return { formulas: this.formulaCells.size, cellEdges, rangeEntries }
  }

  /**
   * Evaluates a formula as if it were in the given cell, without storing it (conditional
   * formatting, data validation). Arrays come back whole; nothing spills.
   */
  evaluateFormula(formula: string, sheetIndex = 0, row = 0, col = 0): Scalar | Matrix {
    const parsed = parseFormula(formula.startsWith('=') ? formula.slice(1) : formula)
    if (!parsed.ok) return Errors.NAME
    const restoreBudget = calculationBudget(this.options.maxWork)
    try {
      const raw = this.interpreter.run(parsed.ast, sheetIndex, row, col, false)
      if (isReference(raw)) {
        if (raw.areas.length !== 1) return Errors.VALUE
        const area = raw.areas[0]!
        if (isSingle(area)) return this.host.readCell(area.sheet, area.top, area.left) ?? 0
        return zeroBlanks(this.host.readArea(area))
      }
      if (isLambda(raw)) return Errors.CALC
      if (isMatrix(raw)) return logicalSize(raw).rows === 1 && logicalSize(raw).cols === 1 ? (raw.data[0] ?? 0) : zeroBlanks(raw)
      return raw ?? 0
    } catch (error) {
      if (isError(error)) return error
      if (error instanceof CalculationStopped) return Errors.NUM
      throw error
    } finally {
      restoreBudget()
    }
  }

  // -------------------------------------------------------------------------------------------
  // Recalculation

  /** Recalculates changed cells and their dependents (everything with `full`). */
  recalc(options: RecalcOptions = {}): RecalcResult {
    const calc: CalcState = {
      epoch: ++this.epoch,
      current: undefined,
      needs: [],
      reads: [],
      pending: [],
      worklist: [],
      changed: new Map(),
      keep: options.keepCachedFor,
      now: undefined,
      areas: new Map(),
      iterating: false,
    }
    this.calc = calc
    const restoreBudget = calculationBudget(this.options.maxWork)
    let stoppedEarly = false
    try {
      if (options.full) {
        for (const cell of this.formulaCells) this.pend(cell)
      } else {
        const queue: Dep[] = [...this.changedRects]
        const root = (cell: Cell) => {
          if (!cell.formula || cell.state === PENDING) return
          this.pend(cell)
          queue.push(positionOf(cell))
          if (cell.spill) queue.push({ sheet: cell.sheet, ...spillRect(cell, cell.spill) })
        }
        for (const cell of this.dirty) root(cell)
        for (const cell of this.volatileCells) root(cell)
        this.closure(queue, false)
      }
      this.dirty.clear()
      this.changedRects = []
      for (const group of this.order(calc.pending)) {
        if (group.length === 1 && !group[0]!.selfLoop) this.runPull(group[0]!)
        else this.resolveCycle(group.filter((cell) => cell.state === PENDING))
      }
      for (let i = 0; i < calc.worklist.length; i++) this.runPull(calc.worklist[i]!)
    } catch (error) {
      if (!(error instanceof CalculationStopped)) throw error
      stoppedEarly = true
    } finally {
      restoreBudget()
      for (const cell of calc.pending) {
        if (stoppedEarly && cell.state !== CLEAN) this.dirty.add(cell)
        cell.state = CLEAN
        cell.onStack = false
        cell.tIndex = -1
        cell.tOn = false
        cell.selfLoop = false
      }
      for (const sheet of this.sheets) sheet.pendingIndex = undefined
      this.calc = undefined
    }
    return { changed: [...calc.changed.values()], stoppedEarly }
  }

  private pend(cell: Cell): void {
    const calc = this.calc!
    if (cell.epoch !== calc.epoch) {
      cell.epoch = calc.epoch
      cell.commits = 0
      cell.attempts = 0
    }
    cell.state = PENDING
    calc.pending.push(cell)
  }

  /** Marks everything downstream of `queue` pending (and, mid-recalc, schedules it). */
  private closure(queue: Dep[], schedule: boolean): void {
    const calc = this.calc!
    const token = newQueryToken()
    try {
      for (let i = 0; i < queue.length; i++) {
        consumeWork()
        this.dependentsOf(queue[i]!, token, (cell) => {
          if (cell.state !== CLEAN || !cell.formula) return
          if (cell.epoch === calc.epoch && cell.commits > MAX_REEVALUATIONS) return
          this.pend(cell)
          if (schedule) {
            calc.worklist.push(cell)
            calc.areas.clear()
          }
          queue.push(positionOf(cell))
          if (cell.spill) queue.push({ sheet: cell.sheet, ...spillRect(cell, cell.spill) })
        })
      }
    } catch (error) {
      // A spill may already be committed; retain its invalidation roots for the next recalculation.
      if (schedule && error instanceof CalculationStopped) this.changedRects = queue
      throw error
    }
  }

  private dependentsOf(rect: Dep, token: number, visit: (cell: Cell) => void): void {
    const { sheet } = rect
    const { cellDeps } = sheet
    const onCell = (cell: Cell) => {
      consumeWork()
      visit(cell)
    }
    if (cellDeps.size) {
      const area = (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1)
      if (area <= cellDeps.size) {
        for (let row = rect.top; row <= rect.bottom; row++) {
          for (let col = rect.left; col <= rect.right; col++) {
            consumeWork()
            const set = cellDeps.get(cellKey(row, col))
            if (set) for (const cell of set) onCell(cell)
          }
        }
      } else {
        for (const [key, set] of cellDeps) {
          consumeWork()
          const row = Math.floor(key / MAX_COLS)
          const col = key - row * MAX_COLS
          if (row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right) for (const cell of set) onCell(cell)
        }
      }
    }
    sheet.ranges.query(rect, onCell, token)
  }

  /** Tarjan's strongly connected components over pending cells, emitted in evaluation order. */
  private order(pending: Cell[]): Cell[][] {
    for (const cell of pending) {
      consumeWork()
      const sheet = cell.sheet
      sheet.pendingIndex ??= new Map()
      let list = sheet.pendingIndex.get(cell.col)
      if (!list) sheet.pendingIndex.set(cell.col, (list = []))
      list.push(cell)
    }
    for (const sheet of this.sheets) if (sheet.pendingIndex) for (const list of sheet.pendingIndex.values()) list.sort((a, b) => a.row - b.row)
    const groups: Cell[][] = []
    const stack: Cell[] = []
    let index = 0
    const open = (cell: Cell) => {
      cell.tIndex = cell.tLow = index++
      cell.tOn = true
      stack.push(cell)
      return { cell, next: this.pendingPrecedents(cell) }
    }
    for (const root of pending) {
      if (root.tIndex >= 0 || root.state !== PENDING) continue
      const frames = [open(root)]
      while (frames.length) {
        consumeWork()
        const frame = frames[frames.length - 1]!
        const step = frame.next.next()
        if (!step.done) {
          const next = step.value
          if (next === frame.cell) frame.cell.selfLoop = true
          else if (next.tIndex < 0) frames.push(open(next))
          else if (next.tOn) frame.cell.tLow = Math.min(frame.cell.tLow, next.tIndex)
          continue
        }
        frames.pop()
        const cell = frame.cell
        const parent = frames[frames.length - 1]
        if (parent) parent.cell.tLow = Math.min(parent.cell.tLow, cell.tLow)
        if (cell.tLow === cell.tIndex) {
          const group: Cell[] = []
          let member: Cell
          do {
            consumeWork()
            member = stack.pop()!
            member.tOn = false
            group.push(member)
          } while (member !== cell)
          groups.push(group.reverse())
        }
      }
    }
    return groups
  }

  /** Lazy predecessors keep overlapping ranges from retaining quadratic lists in DFS frames. */
  private *pendingPrecedents(cell: Cell): Generator<Cell> {
    const formula = cell.formula
    if (!formula) return
    for (const deps of [formula.deps, formula.dynamicDeps]) {
      for (const dep of deps) {
        consumeWork()
        const { sheet } = dep
        if (isSingle(dep)) {
          const other = sheet.get(dep.top, dep.left)
          if (other?.state === PENDING) {
            consumeWork()
            yield other
          }
          if (sheet.spills.size) {
            const owner = sheet.spills.ownerAt(dep.top, dep.left)
            if (owner && owner !== other && owner.state === PENDING) {
              consumeWork()
              yield owner
            }
          }
          continue
        }
        yield* this.pendingIn(sheet, dep)
        if (sheet.spills.size) {
          for (const owner of sheet.spills.intersecting(dep, true)) {
            consumeWork()
            if (owner.state === PENDING) yield owner
          }
        }
      }
    }
  }

  private *pendingIn(sheet: SheetData, rect: Rect): Generator<Cell> {
    const index = sheet.pendingIndex
    if (!index) return
    function *scan(cells: Cell[]): Generator<Cell> {
      let lo = 0
      let hi = cells.length
      while (lo < hi) {
        consumeWork()
        const mid = (lo + hi) >> 1
        if (cells[mid]!.row < rect.top) lo = mid + 1
        else hi = mid
      }
      for (let k = lo; k < cells.length && cells[k]!.row <= rect.bottom; k++) {
        consumeWork()
        if (cells[k]!.state === PENDING) yield cells[k]!
      }
    }
    if (rect.right - rect.left + 1 <= index.size) {
      for (let col = rect.left; col <= rect.right; col++) {
        consumeWork()
        const cells = index.get(col)
        if (cells) yield* scan(cells)
      }
    } else {
      for (const [col, cells] of index) {
        consumeWork()
        if (col >= rect.left && col <= rect.right) yield* scan(cells)
      }
    }
  }

  /**
   * Evaluates a cell, first evaluating any pending cells it turns out to read: a depth-first
   * search with an explicit stack of frames. Only the frames form the current path, so a cell is
   * circular exactly when it needs a cell that has an open frame.
   */
  private runPull(root: Cell): void {
    if (root.state !== PENDING) return
    const frames: { cell: Cell; needs: Cell[] | undefined; next: number }[] = [{ cell: root, needs: undefined, next: 0 }]
    root.onStack = true
    root.stackPos = 0
    while (frames.length) {
      const frame = frames[frames.length - 1]!
      const { cell } = frame
      if (cell.state !== PENDING) {
        frames.pop()
        cell.onStack = false
        continue
      }
      if (frame.needs && frame.next < frame.needs.length) {
        const need = frame.needs[frame.next++]!
        if (need.state !== PENDING) continue
        if (need.onStack) {
          this.resolveCycle(frames.slice(need.stackPos).map((open) => open.cell).filter((member) => member.state === PENDING))
          continue
        }
        need.onStack = true
        need.stackPos = frames.length
        frames.push({ cell: need, needs: undefined, next: 0 })
        continue
      }
      const needs = this.attempt(cell)
      if (needs) {
        frame.needs = needs
        frame.next = 0
      }
    }
  }

  /** One evaluation attempt: commits and returns undefined, or returns the pending cells it read. */
  private attempt(cell: Cell): Cell[] | undefined {
    const formula = cell.formula
    const calc = this.calc!
    if (!formula) {
      cell.state = CLEAN
      return undefined
    }
    if (cell.cached && (this.unsupported(formula) || calc.keep?.(cell.sheet.index, cell.row, cell.col))) {
      cell.state = CLEAN
      return undefined
    }
    if (++cell.attempts > MAX_ATTEMPTS) {
      this.commit(cell, { value: Errors.CALC }, undefined)
      return undefined
    }
    calc.current = cell
    calc.needs = []
    calc.reads = []
    let result: Finalized
    try {
      result = this.evaluate(cell, formula)
    } catch (error) {
      if (error instanceof CalculationStopped) throw error
      result = { value: isError(error) ? error : Errors.VALUE }
    } finally {
      calc.current = undefined
    }
    if (calc.needs.length) return calc.needs
    this.commit(cell, result, calc.reads)
    return undefined
  }

  private evaluate(cell: Cell, formula: FormulaInfo): Finalized {
    if (formula.unsupported || formula.array && formula.array.rows * formula.array.cols > MAX_EXPANDED_CELLS) return { value: cell.value }
    if (!formula.ast) return { value: Errors.NAME }
    const raw = this.interpreter.run(formula.ast, cell.sheet.index, cell.row, cell.col, formula.legacy && !formula.array)
    return this.finalize(cell, formula, raw)
  }

  /** Turns a formula's raw result into the cell value and, for arrays, the data to spill. */
  private finalize(cell: Cell, formula: FormulaInfo, raw: Value): Finalized {
    if (formula.array) {
      let source: Scalar | Matrix
      if (isReference(raw)) source = raw.areas.length === 1 ? this.host.readArea(raw.areas[0]!) : Errors.VALUE
      else if (isLambda(raw)) source = Errors.CALC
      else source = raw
      const { rows, cols } = formula.array
      checkArraySize(rows, cols)
      const data: Scalar[] = new Array(rows * cols)
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data[r * cols + c] = broadcastAt(source, r, c) ?? Errors.NA
      for (let k = 0; k < data.length; k++) if (data[k] === null) data[k] = 0
      return { value: data[0] ?? 0, spill: matrix(rows, cols, data) }
    }
    if (isLambda(raw)) return { value: Errors.CALC }
    if (isReference(raw)) {
      if (raw.areas.length !== 1) return { value: Errors.VALUE }
      const area = raw.areas[0]!
      if (formula.legacy) {
        const hit = this.intersectAt(area, cell.row, cell.col)
        return { value: hit ? (this.host.readCell(area.sheet, hit.row, hit.col) ?? 0) : Errors.VALUE }
      }
      if (isSingle(area)) return { value: this.host.readCell(area.sheet, area.top, area.left) ?? 0 }
      raw = this.host.readArea(area)
    }
    if (isMatrix(raw)) {
      if (!raw.rows || !raw.cols) return { value: Errors.CALC }
      if (formula.legacy || (logicalSize(raw).rows === 1 && logicalSize(raw).cols === 1)) return { value: raw.data[0] ?? 0 }
      const data = zeroBlanks(raw)
      return { value: data.data[0] ?? 0, spill: data }
    }
    return { value: raw ?? 0 }
  }

  private intersectAt(area: Area, row: number, col: number): { row: number; col: number } | undefined {
    if (isSingle(area)) return { row: area.top, col: area.left }
    if (area.left === area.right) return row >= area.top && row <= area.bottom ? { row, col: area.left } : undefined
    if (area.top === area.bottom) return col >= area.left && col <= area.right ? { row: area.top, col } : undefined
    return undefined
  }

  private commit(cell: Cell, result: Finalized, reads: Dep[] | undefined): void {
    const formula = cell.formula!
    const sheet = cell.sheet
    cell.commits++
    cell.state = CLEAN
    cell.cached = false
    cell.circular = false
    let value = result.value
    let spill: Spill | undefined
    let blocked: Rect | undefined
    if (result.spill) {
      const data = result.spill
      const { rows, cols } = logicalSize(data)
      if (formula.array) {
        spill = { rows, cols, data, fixed: true }
      } else if (this.spillBlocked(cell, rows, cols)) {
        value = Errors.SPILL
        blocked = { top: cell.row, left: cell.col, bottom: cell.row + rows - 1, right: cell.col + cols - 1 }
      } else if (rows * cols > MAX_ARRAY_CELLS) {
        value = Errors.NUM
      } else {
        spill = { rows, cols, data, fixed: false }
      }
    }
    if (blocked) {
      cell.blocked = blocked
      sheet.blocked.add(cell)
    } else if (cell.blocked) {
      cell.blocked = undefined
      sheet.blocked.delete(cell)
    }
    let stopped: CalculationStopped | undefined
    try {
      this.replaceSpill(cell, spill, true)
    } catch (error) {
      if (!(error instanceof CalculationStopped)) throw error
      stopped = error
    }
    // Invalidation can stop after installing the spill, so finish the computed anchor consistently.
    if (!sameScalar(cell.value, value)) this.recordChange(sheet, cell.row, cell.col)
    cell.value = value
    if (reads) this.updateDynamicDeps(cell, formula, reads)
    if (stopped) throw stopped
  }

  private recordChange(sheet: SheetData, row: number, col: number): void {
    const changed = this.calc?.changed
    if (changed) changed.set(`${sheet.index}:${row}:${col}`, { sheet: sheet.index, row, col })
  }

  private spillBlocked(cell: Cell, rows: number, cols: number): boolean {
    if (cell.row + rows > MAX_ROWS || cell.col + cols > MAX_COLS) return true
    const sheet = cell.sheet
    const rect = { top: cell.row, left: cell.col, bottom: cell.row + rows - 1, right: cell.col + cols - 1 }
    const lastCol = Math.min(rect.right, sheet.columns.length - 1)
    for (let col = rect.left; col <= lastCol; col++) {
      const column = sheet.columns[col]
      if (!column) continue
      const last = Math.min(rect.bottom, column.length - 1)
      for (let row = rect.top; row <= last; row++) {
        const other = column[row]
        if (other && other !== cell && (other.value !== null || other.formula)) return true
      }
    }
    if (sheet.spills.size) for (const owner of sheet.spills.intersecting(rect)) if (owner !== cell) return true
    return false
  }

  /** Installs a new spill (or none), reporting changed cells and re-dirtying readers mid-recalc. */
  private replaceSpill(cell: Cell, next: Spill | undefined, track: boolean): void {
    const previous = cell.spill
    if (!previous && !next) return
    const sheet = cell.sheet
    const before = previous && spillRect(cell, previous)
    const after = next && spillRect(cell, next)
    if (previous) sheet.spills.remove(cell)
    cell.spill = next
    if (next && after) {
      sheet.spills.add(cell, after)
      sheet.grow(after.bottom, after.right)
    }
    if (!track) return
    let moved = !previous || !next || previous.rows !== next.rows || previous.cols !== next.cols
    const report = (row: number, col: number, old: Scalar, value: Scalar) => {
      if (row === cell.row && col === cell.col) return
      if (!sameScalar(old, value)) {
        moved = true
        this.recordChange(sheet, row, col)
      }
    }
    if (previous && next && !moved) {
      for (let r = 0; r < next.rows; r++) for (let c = 0; c < next.cols; c++) report(cell.row + r, cell.col + c, matrixGet(previous.data, r, c), matrixGet(next.data, r, c))
      if (!moved) return
    } else {
      const bounds = [before, after].filter((rect): rect is Rect => rect !== undefined)
      const bottom = Math.max(...bounds.map((rect) => rect.bottom))
      const right = Math.max(...bounds.map((rect) => rect.right))
      for (let row = cell.row; row <= bottom; row++) {
        for (let col = cell.col; col <= right; col++) {
          const inBefore = before && row <= before.bottom && col <= before.right
          const inAfter = after && row <= after.bottom && col <= after.right
          if (!inBefore && !inAfter) continue
          report(row, col, inBefore ? spillValueOf(cell, previous!, row, col) : null, inAfter ? spillValueOf(cell, next!, row, col) : null)
        }
      }
    }
    const rects = [before, after].filter((rect): rect is Rect => rect !== undefined).map((rect) => ({ sheet, ...rect }))
    if (before && (!after || !contains(after, before))) this.wakeBlocked(sheet, before, cell)
    if (this.calc) {
      this.calc.areas.clear()
      this.closure(rects, true)
    }
    else this.changedRects.push(...rects)
  }

  private updateDynamicDeps(cell: Cell, formula: FormulaInfo, reads: Dep[]): void {
    const extra: Dep[] = []
    const seen = new Set<string>()
    for (const read of reads) {
      if (isSingle(read) && read.sheet.id === cell.sheet.id && read.top === cell.row && read.left === cell.col) continue
      if (isSingle(read) && formula.cellKeys.has(this.depKey(read))) continue
      if (formula.rangeDeps.some((dep) => dep.sheet === read.sheet && contains(dep, read))) continue
      const key = `${read.sheet.id}:${read.top},${read.left},${read.bottom},${read.right}`
      if (seen.has(key)) continue
      seen.add(key)
      extra.push(read)
    }
    const old = formula.dynamicDeps
    if (old.length === extra.length && old.every((dep, i) => dep.sheet === extra[i]!.sheet && dep.top === extra[i]!.top && dep.left === extra[i]!.left && dep.bottom === extra[i]!.bottom && dep.right === extra[i]!.right)) return
    this.unregister(cell, old)
    formula.dynamicDeps = extra
    this.register(cell, extra)
  }

  private resolveCycle(members: Cell[]): void {
    if (!members.length) return
    const iterative = this.options.iterative
    if (!iterative || iterative.maxIterations < 1) {
      for (const member of members) {
        this.commit(member, { value: 0 }, undefined)
        member.circular = true
      }
      return
    }
    for (const member of members) member.state = ITERATING
    const calc = this.calc!
    calc.iterating = true
    calc.areas.clear()
    for (let iteration = 0; iteration < iterative.maxIterations; iteration++) {
      let change = 0
      for (const member of members) {
        const before = member.value
        calc.current = member
        calc.needs = []
        calc.reads = []
        let result: Finalized
        try {
          result = this.evaluate(member, member.formula!)
        } catch (error) {
          if (error instanceof CalculationStopped) throw error
          result = { value: isError(error) ? error : Errors.VALUE }
        } finally {
          calc.current = undefined
        }
        this.commit(member, result, calc.reads)
        member.state = ITERATING
        const after = member.value
        change = Math.max(change, typeof before === 'number' && typeof after === 'number' ? Math.abs(after - before) : sameScalar(before, after) ? 0 : Infinity)
      }
      if (change < iterative.maxChange) break
    }
    calc.iterating = false
    for (const member of members) {
      member.state = CLEAN
      member.circular = true
    }
  }

  // -------------------------------------------------------------------------------------------
  // Dependency bookkeeping

  private depKey(dep: Dep): number {
    return dep.sheet.id * 2 ** 34 + cellKey(dep.top, dep.left)
  }

  private register(cell: Cell, deps: Dep[]): void {
    for (const dep of deps) {
      if (isSingle(dep)) {
        const key = cellKey(dep.top, dep.left)
        let set = dep.sheet.cellDeps.get(key)
        if (!set) dep.sheet.cellDeps.set(key, (set = new Set()))
        set.add(cell)
      } else {
        dep.sheet.ranges.add(dep, cell)
      }
    }
  }

  private unregister(cell: Cell, deps: Dep[]): void {
    for (const dep of deps) {
      if (isSingle(dep)) {
        const key = cellKey(dep.top, dep.left)
        const set = dep.sheet.cellDeps.get(key)
        if (set?.delete(cell) && !set.size) dep.sheet.cellDeps.delete(key)
      } else {
        dep.sheet.ranges.remove(dep, cell)
      }
    }
  }

  /** (Re)computes a formula's static dependencies and flags and registers them. */
  private bind(cell: Cell): void {
    const formula = cell.formula!
    this.unbind(cell)
    const analysis = this.analyze(formula.ast, cell.sheet, cell.row, cell.col)
    formula.deps = analysis.deps
    formula.cellKeys = new Set(analysis.deps.filter(isSingle).map((dep) => this.depKey(dep)))
    formula.rangeDeps = analysis.deps.filter((dep) => !isSingle(dep))
    formula.dynamicDeps = []
    formula.names = analysis.names
    formula.volatile = analysis.volatile
    formula.unknownFunction = analysis.unknown
    formula.externalRef = analysis.external
    formula.usesTables = analysis.tables
    this.register(cell, formula.deps)
    for (const name of formula.names) {
      let users = this.nameUsers.get(name)
      if (!users) this.nameUsers.set(name, (users = new Set()))
      users.add(cell)
    }
    if (formula.usesTables) this.tableUsers.add(cell)
    if (formula.volatile) this.volatileCells.add(cell)
  }

  private unbind(cell: Cell): void {
    const formula = cell.formula!
    this.unregister(cell, formula.deps)
    this.unregister(cell, formula.dynamicDeps)
    for (const name of formula.names) {
      const users = this.nameUsers.get(name)
      if (users?.delete(cell) && !users.size) this.nameUsers.delete(name)
    }
    this.tableUsers.delete(cell)
    this.volatileCells.delete(cell)
  }

  private rebindUsers(names: string[]): void {
    const cells = new Set<Cell>()
    for (const name of names) for (const cell of this.nameUsers.get(name) ?? []) cells.add(cell)
    for (const cell of cells) {
      if (!cell.formula) continue
      this.bind(cell)
      this.dirty.add(cell)
    }
  }

  private removeFormula(cell: Cell): void {
    this.unbind(cell)
    this.formulaCells.delete(cell)
    this.dirty.delete(cell)
    if (cell.spill) {
      const rect = { sheet: cell.sheet, ...spillRect(cell, cell.spill) }
      cell.sheet.spills.remove(cell)
      cell.spill = undefined
      this.changedRects.push(rect)
      this.wakeBlocked(cell.sheet, rect)
    }
    if (cell.blocked) {
      cell.sheet.blocked.delete(cell)
      cell.blocked = undefined
    }
    cell.formula = undefined
    cell.circular = false
    cell.cached = false
  }

  private dropSheet(sheet: SheetData): void {
    for (const cell of [...this.formulaCells]) {
      if (cell.sheet !== sheet) continue
      this.unbind(cell)
      this.formulaCells.delete(cell)
      this.dirty.delete(cell)
    }
    this.changedRects = this.changedRects.filter((rect) => rect.sheet !== sheet)
  }

  /** Something changed inside another formula's spill range: that formula must re-check it. */
  private dirtySpillOwner(cell: Cell): void {
    const owner = cell.sheet.spills.size ? cell.sheet.spills.ownerAt(cell.row, cell.col) : undefined
    if (owner && owner !== cell) this.dirty.add(owner)
  }

  /** Space opened up: formulas showing #SPILL! because of it try again. */
  private wakeBlocked(sheet: SheetData, rect: Rect, except?: Cell): void {
    for (const cell of sheet.blocked) {
      if (cell === except || !cell.blocked || !intersects(cell.blocked, rect)) continue
      if (this.calc) {
        if (cell.state === CLEAN && !(cell.epoch === this.calc.epoch && cell.commits > MAX_REEVALUATIONS)) {
          this.pend(cell)
          this.calc.worklist.push(cell)
          this.calc.areas.clear()
        }
      } else {
        this.dirty.add(cell)
      }
    }
  }

  private seedCached(cell: Cell, cached: Scalar | Matrix): void {
    const formula = cell.formula!
    cell.cached = true
    if (formula.unsupported || formula.array && formula.array.rows * formula.array.cols > MAX_EXPANDED_CELLS) {
      cell.value = isMatrix(cached) ? cached.data[0] ?? null : cached
      return
    }
    if (!isMatrix(cached)) {
      cell.value = cached
      if (formula.array) this.replaceSpill(cell, { rows: formula.array.rows, cols: formula.array.cols, data: this.fill(cached, formula.array), fixed: true }, false)
      return
    }
    cell.value = cached.data[0] ?? null
    if (formula.array) {
      this.replaceSpill(cell, { rows: formula.array.rows, cols: formula.array.cols, data: this.fill(cached, formula.array), fixed: true }, false)
    } else if (cached.rows * cached.cols > 1 && cell.row + cached.rows <= MAX_ROWS && cell.col + cached.cols <= MAX_COLS) {
      this.replaceSpill(cell, { rows: cached.rows, cols: cached.cols, data: cached, fixed: false }, false)
    }
  }

  private fill(source: Scalar | Matrix, size: { rows: number; cols: number }): Matrix {
    checkArraySize(size.rows, size.cols)
    const data: Scalar[] = new Array(size.rows * size.cols)
    for (let r = 0; r < size.rows; r++) for (let c = 0; c < size.cols; c++) data[r * size.cols + c] = broadcastAt(source, r, c) ?? Errors.NA
    return matrix(size.rows, size.cols, data)
  }

  private unsupported(formula: FormulaInfo): boolean {
    return !!formula.unsupported || !!formula.array && formula.array.rows * formula.array.cols > MAX_EXPANDED_CELLS || formula.unknownFunction || formula.externalRef || !formula.ast
  }

  /** Static analysis: references, names, flags. Iterative, with LET/LAMBDA scoping. */
  private analyze(ast: Node | undefined, sheet: SheetData, row: number, col: number) {
    const result = { deps: [] as Dep[], names: new Set<string>(), volatile: false, unknown: false, external: false, tables: false }
    if (!ast) return result
    const seenDeps = new Set<string>()
    const addDep = (dep: Dep) => {
      const key = `${dep.sheet.id}:${dep.top},${dep.left},${dep.bottom},${dep.right}`
      if (seenDeps.has(key)) return
      seenDeps.add(key)
      result.deps.push(dep)
    }
    const seenNames = new Set<NameDefinition>()
    const followName = (definition: NameDefinition | undefined) => {
      if (definition?.ast && !seenNames.has(definition)) {
        seenNames.add(definition)
        stack.push({ node: definition.ast, locals: undefined })
      }
    }
    const stack: { node: Node; locals: ReadonlySet<string> | undefined }[] = [{ node: ast, locals: undefined }]
    const pushAll = (nodes: (Node | null)[], locals: ReadonlySet<string> | undefined) => {
      for (const node of nodes) if (node) stack.push({ node, locals })
    }
    let steps = 0
    while (stack.length && ++steps < 1_000_000) {
      const { node, locals } = stack.pop()!
      switch (node.type) {
        case 'ref': {
          const rect = refRect(node.ref)
          const prefix = node.ref.sheet
          if (!prefix) {
            addDep({ sheet, ...rect })
            break
          }
          const first = this.sheetsByName.get(prefix.sheet.toUpperCase())
          const last = prefix.lastSheet === undefined ? first : this.sheetsByName.get(prefix.lastSheet.toUpperCase())
          if (!first || !last) break
          for (let i = Math.min(first.index, last.index); i <= Math.max(first.index, last.index); i++) addDep({ sheet: this.sheets[i]!, ...rect })
          break
        }
        case 'name': {
          if (!node.sheet && locals?.has(node.name)) break
          result.names.add(node.name)
          const definition = this.findName(node.name, node.sheet?.sheet, sheet)
          if (definition) {
            followName(definition)
            break
          }
          const table = node.sheet ? undefined : this.tablesByName.get(node.name)
          if (table) {
            result.tables = true
            const area = structuredArea(table.def, { items: [] }, row)
            if (!isError(area)) addDep({ sheet: table.sheet, top: area.top, left: area.left, bottom: area.bottom, right: area.right })
          }
          break
        }
        case 'structured': {
          result.tables = true
          const table = node.ref.table === undefined ? undefined : this.tablesByName.get(node.ref.table.toUpperCase())
          const target = table ?? (node.ref.table === undefined ? this.tables.find((entry) => entry.sheet === sheet && row >= entry.def.top && row <= entry.def.bottom && col >= entry.def.left && col <= entry.def.right) : undefined)
          if (target) {
            const area = structuredArea(target.def, node.ref, row)
            if (!isError(area)) addDep({ sheet: target.sheet, top: area.top, left: area.left, bottom: area.bottom, right: area.right })
          }
          break
        }
        case 'external':
          result.external = true
          break
        case 'call': {
          const { name, args } = node
          if (!node.sheet && locals?.has(name)) {
            pushAll(args, locals)
            break
          }
          if (!node.sheet && name === 'LET') {
            const scope = new Set(locals ?? [])
            for (let i = 0; i + 1 < args.length; i += 2) {
              const value = args[i + 1]
              if (value) stack.push({ node: value, locals: new Set(scope) })
              const variable = args[i]
              if (variable?.type === 'name') scope.add(variable.name)
            }
            const body = args.length % 2 === 1 ? args[args.length - 1] : undefined
            if (body) stack.push({ node: body, locals: scope })
            break
          }
          if (!node.sheet && name === 'LAMBDA') {
            const scope = new Set(locals ?? [])
            for (const param of args.slice(0, -1)) {
              if (param?.type === 'name') scope.add(param.name)
              else if (param?.type === 'structured' && param.ref.firstColumn) scope.add(param.ref.firstColumn.trim().toUpperCase().replace(/^_XLPM\./, ''))
            }
            const body = args[args.length - 1]
            if (body) stack.push({ node: body, locals: scope })
            break
          }
          if (!node.sheet && OWNED_FUNCTIONS.has(name)) {
            if (VOLATILE_EVALUATOR_FUNCTIONS.has(name)) result.volatile = true
            // Functions that only look at where a reference points do not depend on its contents.
            const addressOnly = ADDRESS_ONLY_ARGS.get(name)
            pushAll(
              addressOnly === undefined ? args : args.filter((arg, i) => !(arg && i < addressOnly && isPureReference(arg))),
              locals,
            )
            break
          }
          const spec = node.sheet ? undefined : this.functions.get(name)
          if (spec) {
            if (spec.volatile) result.volatile = true
            pushAll(args, locals)
            break
          }
          result.names.add(name)
          const definition = this.findName(name, node.sheet?.sheet, sheet)
          if (definition) followName(definition)
          else result.unknown = true
          pushAll(args, locals)
          break
        }
        case 'invoke':
          stack.push({ node: node.callee, locals })
          pushAll(node.args, locals)
          break
        case 'unary':
        case 'postfix':
          stack.push({ node: node.operand, locals })
          break
        case 'binary':
          stack.push({ node: node.right, locals }, { node: node.left, locals })
          break
        case 'paren':
          stack.push({ node: node.expr, locals })
          break
      }
    }
    return result
  }

  // -------------------------------------------------------------------------------------------
  // Lookups

  private sheetAt(index: number): SheetData {
    const sheet = this.sheets[index]
    if (!sheet) throw new RangeError(`No sheet at index ${index}`)
    return sheet
  }

  private nameKey(scope: SheetData | undefined, upper: string): string {
    return `${scope ? scope.id : ''}|${upper}`
  }

  private findName(upper: string, qualifier: string | undefined, sheet: SheetData | undefined): NameDefinition | undefined {
    const scope = qualifier === undefined ? sheet : this.sheetsByName.get(qualifier.toUpperCase())
    if (qualifier !== undefined && !scope) return undefined
    return (scope && this.names.get(this.nameKey(scope, upper))) ?? this.names.get(this.nameKey(undefined, upper))
  }

  private cellValue(sheet: SheetData, row: number, col: number, track: boolean): Scalar {
    const owner = sheet.spills.size ? sheet.spills.ownerAt(row, col) : undefined
    const isAnchor = owner !== undefined && owner.row === row && owner.col === col
    if (owner && !isAnchor && owner.spill!.fixed) {
      if (track) this.need(owner)
      return spillElement(owner, row, col)
    }
    const cell = sheet.get(row, col)
    if (cell) {
      if (track && cell.formula) this.need(cell)
      return cell.value
    }
    if (owner && !isAnchor) {
      if (track) this.need(owner)
      return spillElement(owner, row, col)
    }
    return null
  }

  private need(cell: Cell): void {
    if (this.calc?.current && cell.state === PENDING) {
      consumeWork()
      this.calc.needs.push(cell)
    }
  }

  private recordRead(sheet: SheetData, area: Rect): void {
    const calc = this.calc
    if (calc?.current) calc.reads.push({ sheet, top: area.top, left: area.left, bottom: area.bottom, right: area.right })
  }

  private usedArea(area: Area): Area {
    const sheet = this.sheets[area.sheet]
    if (!sheet) return area
    const huge = (area.bottom - area.top + 1) * (area.right - area.left + 1) > MAX_AREA_CELLS
    let { bottom, right } = area
    if (bottom === MAX_ROWS - 1 || huge) bottom = Math.max(area.top, Math.min(bottom, sheet.maxRow))
    if (right === MAX_COLS - 1 || huge) right = Math.max(area.left, Math.min(right, sheet.maxCol))
    return bottom === area.bottom && right === area.right ? area : { ...area, bottom, right }
  }

  private readArea(area: Area): Matrix {
    const sheet = this.sheets[area.sheet]
    if (!sheet) return matrix(1, 1, [Errors.REF])
    this.recordRead(sheet, area)
    const used = this.usedArea(area)
    const rows = used.bottom - used.top + 1
    const cols = used.right - used.left + 1
    const calc = this.calc
    const cacheable = calc !== undefined && !calc.iterating && rows * cols >= AREA_CACHE_MIN_CELLS
    const key = cacheable ? `${sheet.id}:${area.top},${area.left},${area.bottom},${area.right}` : ''
    if (cacheable) {
      const hit = calc.areas.get(key)
      if (hit) {
        consumeWork(hit.rows * hit.cols)
        return hit
      }
    }
    const needsBefore = calc?.needs.length ?? 0
    checkArraySize(rows, cols)
    const data: Scalar[] = new Array(rows * cols).fill(null)
    const lastCol = Math.min(used.right, sheet.columns.length - 1)
    for (let col = used.left; col <= lastCol; col++) {
      const column = sheet.columns[col]
      if (!column) continue
      const last = Math.min(used.bottom, column.length - 1)
      const offset = col - used.left
      for (let row = used.top; row <= last; row++) {
        const cell = column[row]
        if (!cell) continue
        data[(row - used.top) * cols + offset] = cell.value
        if (cell.formula && cell.state === PENDING) this.need(cell)
      }
    }
    if (sheet.spills.size) {
      for (const owner of sheet.spills.intersecting(used)) {
        this.need(owner)
        const spill = owner.spill!
        const rect = spillRect(owner, spill)
        const top = Math.max(rect.top, used.top)
        const bottom = Math.min(rect.bottom, used.bottom)
        const left = Math.max(rect.left, used.left)
        const right = Math.min(rect.right, used.right)
        for (let row = top; row <= bottom; row++) {
          for (let col = left; col <= right; col++) {
            if (row === owner.row && col === owner.col) continue
            if (!spill.fixed && sheet.get(row, col)) continue
            data[(row - used.top) * cols + (col - used.left)] = spillElement(owner, row, col)
          }
        }
      }
    }
    const result = matrix(rows, cols, data)
    if (used !== area) {
      result.logicalRows = area.bottom - area.top + 1
      result.logicalCols = area.right - area.left + 1
    }
    if (cacheable && calc.needs.length === needsBefore) {
      // Shared between formulas: freeze so a function that mutates its arguments fails loudly.
      Object.freeze(data)
      calc.areas.set(key, result)
    }
    return result
  }

  private nowSerial(): number {
    const ms = this.options.now?.() ?? Date.now()
    return epochMsToSerial(ms - (this.options.timezoneOffset ?? new Date(ms).getTimezoneOffset()) * 60_000, this.date1904)
  }

  private createHost(): EvalHost {
    return {
      functions: this.functions,
      date1904: this.date1904,
      sheetCount: () => this.sheets.length,
      sheetName: (index) => this.sheets[index]?.name,
      sheetIndex: (name) => this.sheetsByName.get(name.toUpperCase())?.index ?? -1,
      readCell: (sheetIndex, row, col) => {
        const sheet = this.sheets[sheetIndex]
        if (!sheet || row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) return Errors.REF
        this.recordRead(sheet, { top: row, left: col, bottom: row, right: col })
        return this.cellValue(sheet, row, col, true)
      },
      readArea: (area) => this.readArea(area),
      usedArea: (area) => this.usedArea(area),
      spillArea: (sheetIndex, row, col) => {
        const sheet = this.sheets[sheetIndex]
        const cell = sheet?.get(row, col)
        if (!sheet || !cell?.formula) return undefined
        this.recordRead(sheet, { top: row, left: col, bottom: row, right: col })
        this.need(cell)
        const spill = cell.spill
        if (!spill || spill.fixed) return undefined
        return { sheet: sheetIndex, top: row, left: col, bottom: row + spill.rows - 1, right: col + spill.cols - 1 }
      },
      formulaText: (sheetIndex, row, col) => {
        const formula = this.sheets[sheetIndex]?.get(row, col)?.formula
        if (!formula) return undefined
        return formula.array ? `{=${formula.text}}` : `=${formula.text}`
      },
      lookupName: (name, qualifier, sheetIndex) => {
        if (qualifier !== undefined && !this.sheetsByName.has(qualifier.toUpperCase())) return Errors.REF
        const definition = this.findName(name, qualifier, this.sheets[sheetIndex])
        if (!definition) return undefined
        return definition.ast ?? Errors.NAME
      },
      table: (name, sheetIndex, row, col) => {
        if (name !== undefined) return this.tablesByName.get(name.toUpperCase())?.def
        return tableAt(
          this.tables.map((entry) => entry.def),
          sheetIndex,
          row,
          col,
        )
      },
      now: () => {
        const calc = this.calc
        if (!calc) return this.nowSerial()
        return (calc.now ??= this.nowSerial())
      },
      random: () => (this.options.random ?? Math.random)(),
    }
  }
}

function spillValueOf(cell: Cell, spill: Spill, row: number, col: number): Scalar {
  return matrixGet(spill.data, row - cell.row, col - cell.col)
}
