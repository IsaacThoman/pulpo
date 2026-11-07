import { MAX_COLS, MAX_ROWS, rangeContains, type CellRange } from './address.js'
import type { CellData, CellScalar } from './model/schema.js'
import type { SheetModel, WorkbookModel } from './model/workbook.js'

/** A cell's value as shown: a scalar, or an error by its code. Blank cells are null. */
export type CellValue = CellScalar | { e: string }

export function isErrorValue(value: CellValue | undefined): value is { e: string } {
  return typeof value === 'object' && value !== null
}

/** The value of stored content (a literal, or a formula's cached result). */
export function storedValue(data: CellData | undefined): CellValue {
  if (!data) return null
  if (data.t === 'e') return { e: String(data.v) }
  return data.v ?? null
}

/**
 * Where views and exports get cell values. The calculation engine implements it; without one,
 * `CachedValues` shows what the file had cached.
 */
export interface SheetValues {
  /** The current value at a position, including results spilled from other cells. */
  get(sheet: SheetModel, row: number, col: number): CellValue
  /** For a formula that spills, the size of its result. */
  spill?(sheet: SheetModel, row: number, col: number): { rows: number; cols: number } | undefined
  /** Evaluates an A1 formula at a position. Optional input previews a proposed cell without publishing edits. */
  evaluate?(sheet: SheetModel, row: number, col: number, formula: string, input?: CellData): CellValue | CellValue[][]
  /** Refresh inside a bulk transaction before reading relocated formulas. */
  refresh?(): void
  /** Called after values change (recalculation or remote edits). Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
}

/** Values as cached in the file, with spilled array results from each anchor's cache. */
export class CachedValues implements SheetValues {
  /** Per sheet: "row,col" of each spilled member → its value. Rebuilt lazily after changes. */
  private spills = new Map<string, Map<string, CellValue>>()
  private readonly listeners = new Set<() => void>()
  private readonly unobserve: () => void

  constructor(readonly workbook: WorkbookModel) {
    const onChange = () => {
      this.spills.clear()
      for (const listener of this.listeners) listener()
    }
    const root = workbook.root
    root.observeDeep(onChange)
    this.unobserve = () => root.unobserveDeep(onChange)
  }

  destroy(): void {
    this.unobserve()
    this.listeners.clear()
  }

  get(sheet: SheetModel, row: number, col: number): CellValue {
    const data = sheet.cell(row, col)
    if (data) return storedValue(data)
    return this.spillsOf(sheet).get(`${row},${col}`) ?? null
  }

  spill(sheet: SheetModel, row: number, col: number): { rows: number; cols: number } | undefined {
    const cache = sheet.cell(row, col)?.spillCache
    return cache ? { rows: cache.length, cols: cache[0]?.length ?? 0 } : undefined
  }

  private spillsOf(sheet: SheetModel): Map<string, CellValue> {
    let found = this.spills.get(sheet.id)
    if (found) return found
    found = new Map()
    for (const [key, data] of sheet.cells) {
      if (!data.spillCache) continue
      const position = sheet.position(key)
      if (!position) continue
      data.spillCache.forEach((values, dr) =>
        values.forEach((value, dc) => {
          if (dr || dc) found!.set(`${position.row + dr},${position.col + dc}`, value)
        }),
      )
    }
    this.spills.set(sheet.id, found)
    return found
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

/** Visits populated positions once, including virtual spill/legacy-array members, without scanning blank gaps. */
export function forEachPopulatedValue(sheet: SheetModel, values: SheetValues, ranges: CellRange[], visit: (row: number, col: number, value: CellValue) => void): void {
  const spills: CellRange[] = []
  sheet.forEachCell((row, col, data) => {
    if (ranges.some((range) => rangeContains(range, row, col))) {
      const value = values.get(sheet, row, col)
      if (value !== null) visit(row, col, value)
    }
    const size = values.spill?.(sheet, row, col)
    const rows = size?.rows ?? (data.oversizedArray ? undefined : data.array?.rows) ?? data.spillCache?.length ?? 1
    const cols = size?.cols ?? (data.oversizedArray ? undefined : data.array?.cols) ?? data.spillCache?.[0]?.length ?? 1
    if (rows > 1 || cols > 1) spills.push({ top: row, left: col, bottom: Math.min(MAX_ROWS - 1, row + rows - 1), right: Math.min(MAX_COLS - 1, col + cols - 1) })
  })
  const seen = new Set<string>()
  for (const spill of spills) for (const domain of ranges) {
    const range = { top: Math.max(spill.top, domain.top), left: Math.max(spill.left, domain.left), bottom: Math.min(spill.bottom, domain.bottom), right: Math.min(spill.right, domain.right) }
    if (range.top > range.bottom || range.left > range.right) continue
    for (let row = range.top; row <= range.bottom; row++) for (let col = range.left; col <= range.right; col++) {
      if (sheet.cell(row, col)) continue
      const key = `${row},${col}`
      if (seen.has(key)) continue
      seen.add(key)
      const value = values.get(sheet, row, col)
      if (value !== null) visit(row, col, value)
    }
  }
}
