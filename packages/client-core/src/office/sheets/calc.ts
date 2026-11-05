import * as Y from 'yjs'
import { MAX_EXPANDED_CELLS } from './limits.js'
import { FormulaEngine, type CellInput } from './formula/engine.js'
import { functionRegistry } from './formula/functions/index.js'
import { TEXT_FORMAT_FUNCTIONS } from './formula/functions/text-format.js'
import { errorFromCode, isError, isMatrix, matrix, type FunctionSpec, type Matrix, type Scalar } from './formula/types.js'
import { toA1Form } from './model/formula-ids.js'
import type { CellData, SheetTable } from './model/schema.js'
import type { SheetModel, WorkbookModel } from './model/workbook.js'
import type { CellValue, SheetValues } from './values.js'

let registry: Map<string, FunctionSpec> | undefined

/** Every function the engine knows: the library plus TEXT, VALUE, and friends. */
export function sheetFunctions(): Map<string, FunctionSpec> {
  registry ??= functionRegistry(TEXT_FORMAT_FUNCTIONS)
  return registry
}

function fromScalar(value: Scalar): CellValue {
  if (isError(value)) return { e: value.code }
  return value
}

function toScalar(value: CellData['v'] | { e: string } | undefined, error = false): Scalar {
  if (value === undefined || value === null) return null
  if (typeof value === 'object') return errorFromCode(value.e) ?? errorFromCode('#VALUE!')!
  if (error) return errorFromCode(String(value)) ?? errorFromCode('#VALUE!')!
  return value
}

/** What a stored cell gives the engine. */
export function engineInput(sheet: SheetModel, data: CellData | undefined, useCache = true): CellInput {
  if (!data) return undefined
  if (data.f === undefined) {
    if (data.runs?.length) return { value: data.runs.map((run) => run.text).join('') }
    return { value: toScalar(data.v, data.t === 'e') }
  }
  const cached = !useCache && !data.oversizedArray
    ? undefined
    : data.spillCache && data.spillCache.length * (data.spillCache[0]?.length ?? 0) <= MAX_EXPANDED_CELLS
    ? matrix(data.spillCache.length, data.spillCache[0]?.length ?? 0, data.spillCache.flat().map((value) => toScalar(value)))
    : data.v === undefined
      ? undefined
      : toScalar(data.v, data.t === 'e')
  return {
    formula: toA1Form(data.f, sheet),
    ...(data.oversizedArray ? { unsupported: true } : {}),
    ...(data.array ? { array: data.array } : {}),
    ...(cached !== undefined ? { cached } : {}),
    // Formulas read from a file without the dynamic-array flag keep pre-365 semantics (implicit
    // intersection); formulas typed here, and dynamic ones from files, spill.
    ...(!data.dynamic && !data.array ? { legacy: true } : {}),
  }
}

/**
 * Calculates a workbook: loads every cell of the model into the formula engine, keeps it in step
 * with edits (incrementally for cell edits, rebuilt for structural ones), and serves the values
 * views and exports show. Cells the engine can't calculate (unknown functions, external
 * references, data tables) keep the values cached in the file.
 */
export class SheetCalc implements SheetValues {
  private engine!: FormulaEngine
  private sheetIndex = new Map<string, number>()
  private cellMaps = new Map<Y.Map<CellData>, SheetModel>()
  private readonly listeners = new Set<() => void>()
  private readonly observer: (events: Y.YEvent<Y.AbstractType<unknown>>[]) => void
  /** The work allowance was exhausted; unfinished formulas retain their prior values. */
  stoppedEarly = false
  private dirty = false
  private destroyed = false

  constructor(
    readonly workbook: WorkbookModel,
    private readonly options: {
      now?: () => number
      random?: () => number
      /** Follow edits to the document (default); false for one-off calculations such as exports. */
      live?: boolean
      /** Ignore the values cached in the file and calculate every formula (the formula oracle). */
      ignoreCache?: boolean
      maxWork?: number
    } = {},
  ) {
    this.rebuild()
    this.observer = (events) => this.onChange(events)
    if (options.live !== false) workbook.root.observeDeep(this.observer)
  }

  destroy(): void {
    this.destroyed = true
    this.workbook.root.unobserveDeep(this.observer)
    this.listeners.clear()
  }

  /** Loads a fresh engine, trusting file caches until a local edit has invalidated them. */
  private rebuild(): void {
    const workbook = this.workbook
    this.engine = new FormulaEngine({
      functions: sheetFunctions(),
      ...(this.options.maxWork !== undefined ? { maxWork: this.options.maxWork } : {}),
      date1904: workbook.date1904,
      ...(this.options.now ? { now: this.options.now } : {}),
      ...(this.options.random ? { random: this.options.random } : {}),
      ...(workbook.metaValue('iterate') ? { iterative: { maxIterations: Math.min(1_000, Math.max(0, workbook.metaValue('iterateCount') ?? 100)), maxChange: workbook.metaValue('iterateDelta') ?? 0.001 } } : {}),
    })
    const sheets = workbook.sheets()
    this.sheetIndex = new Map(sheets.map((sheet, index) => [sheet.id, index]))
    this.cellMaps = new Map(sheets.map((sheet) => [sheet.cells, sheet]))
    this.engine.setSheets(sheets.map((sheet) => sheet.name))
    sheets.forEach((sheet, index) => {
      const cells: { row: number; col: number; data: CellData }[] = []
      sheet.forEachCell((row, col, data) => cells.push({ row, col, data }))
      cells.sort((a, b) => a.row - b.row || a.col - b.col)
      for (const { row, col, data } of cells) this.engine.setCell(index, row, col, engineInput(sheet, data, !this.options.ignoreCache))
    })
    for (const name of workbook.names.values()) {
      const scope = name.scope ? this.sheetIndex.get(name.scope) : undefined
      if (name.scope && scope === undefined) continue
      this.engine.setName(name.name, toA1Form(name.formula, name.scope ? workbook.sheet(name.scope) : undefined, workbook), scope)
    }
    this.engine.setTables(
      sheets.flatMap((sheet, index) =>
        [...sheet.tables.values()].flatMap((raw) => {
          const table = raw as SheetTable
          const range = sheet.resolveRange(table.range)
          if (!range) return []
          const columns = table.columns.map((column, offset) => (table.headerRow ? String(sheet.cell(range.top, range.left + offset)?.v ?? column.name) : column.name))
          return [{ name: table.name, sheet: index, ...range, headerRow: table.headerRow, totalsRow: table.totalsRow, columns }]
        }),
      ),
    )
    // Unedited file caches count as calculated; edited workbooks need a full recalculation.
    this.engine.markClean()
    this.recalc(workbook.metaValue('calcDirty') === true)
    this.dirty = false
  }

  private recalc(full = false): void {
    this.stoppedEarly = this.engine.recalc({ full, keepCachedFor: (sheet, row, col) => this.isDataTable(sheet, row, col) }).stoppedEarly
  }

  private isDataTable(sheetIndex: number, row: number, col: number): boolean {
    const sheet = this.workbook.sheets()[sheetIndex]
    return !!sheet?.cell(row, col)?.keep?.fText
  }

  private onChange(events: Y.YEvent<Y.AbstractType<unknown>>[]): void {
    if (this.destroyed) return
    let structural = false
    const edits: [SheetModel, string][] = []
    for (const event of events) {
      const sheet = this.cellMaps.get(event.target as Y.Map<CellData>)
      if (sheet) {
        for (const key of (event as Y.YMapEvent<CellData>).keysChanged) edits.push([sheet, key])
        continue
      }
      // Styles and views don't change values; everything else (rows, columns, sheets, names,
      // tables) moves cells around, which the index-based engine takes as a rebuild.
      const target = event.target
      if (target === this.workbook.meta && [...(event as Y.YMapEvent<unknown>).keysChanged].every((key) => key === 'calcDirty' || key === 'calcTime')) continue
      if (this.isStyleOrView(target)) continue
      structural = true
    }
    if (structural) this.rebuild()
    else if (edits.length) {
      for (const [sheet, key] of edits) {
        const index = this.sheetIndex.get(sheet.id)
        const position = sheet.position(key)
        if (index === undefined || !position) continue
        this.engine.setCell(index, position.row, position.col, engineInput(sheet, sheet.cells.get(key)))
      }
      this.recalc()
    } else return
    for (const listener of this.listeners) listener()
  }

  private isStyleOrView(target: Y.AbstractType<unknown>): boolean {
    for (const sheet of this.workbook.sheets()) {
      if (target === sheet.xf || target === sheet.fmt || target === sheet.view || target === sheet.links || target === sheet.notes || target === sheet.cf || target === sheet.dv || target === sheet.drawings || target === sheet.merges) return true
      // Row heights and column widths don't move cells, unlike the axes themselves.
      if (target === sheet.rowMeta || target === sheet.colMeta) return true
    }
    return false
  }

  /** Recalculates everything, volatile functions included (NOW, RAND). */
  recalculateAll(): void {
    this.stoppedEarly = this.engine.recalc({ full: true, keepCachedFor: (sheet, row, col) => this.isDataTable(sheet, row, col) }).stoppedEarly
    for (const listener of this.listeners) listener()
  }

  get(sheet: SheetModel, row: number, col: number): CellValue {
    if (this.dirty) this.rebuild()
    const index = this.sheetIndex.get(sheet.id)
    if (index === undefined) return null
    return fromScalar(this.engine.getValue(index, row, col))
  }

  spill(sheet: SheetModel, row: number, col: number): { rows: number; cols: number } | undefined {
    const index = this.sheetIndex.get(sheet.id)
    return index === undefined ? undefined : this.engine.getSpill(index, row, col)
  }

  /** The whole result of an array formula or spill anchored at a cell, row by row. */
  spillValues(sheet: SheetModel, row: number, col: number): CellValue[][] | undefined {
    const size = this.spill(sheet, row, col)
    if (!size) return undefined
    return Array.from({ length: size.rows }, (_, dr) => Array.from({ length: size.cols }, (_, dc) => this.get(sheet, row + dr, col + dc)))
  }

  evaluate(sheet: SheetModel, row: number, col: number, formula: string): CellValue | CellValue[][] {
    const index = this.sheetIndex.get(sheet.id) ?? 0
    const result = this.engine.evaluateFormula(formula, index, row, col)
    if (isMatrix(result)) {
      const value = result as Matrix
      return Array.from({ length: value.rows }, (_, r) => Array.from({ length: value.cols }, (_, c) => fromScalar(value.data[r * value.cols + c] ?? null)))
    }
    return fromScalar(result as Scalar)
  }

  /** Whether a formula's value is the file's cached one because the engine can't calculate it. */
  isUnsupported(sheet: SheetModel, row: number, col: number): boolean {
    const index = this.sheetIndex.get(sheet.id)
    return index !== undefined && this.engine.isUnsupported(index, row, col)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
