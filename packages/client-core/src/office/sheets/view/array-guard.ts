import { MAX_ROWS, MAX_COLS, rangeContains, type CellRange } from '../address.js'
import { parseFormula, type Node } from '../formula/parse.js'
import { toA1Form } from '../model/formula-ids.js'
import type { SheetModel } from '../model/workbook.js'
import { isErrorValue, type SheetValues, type CellValue } from '../values.js'
import { contains, intersects } from './clipboard-state.js'
import { DataOperationError } from './data-errors.js'

/** Test union coverage geometrically, including blank array members, without expanding cells. */
function covered(array: CellRange, ranges: CellRange[]): boolean {
  let remaining = [array]
  for (const r of ranges) {
    remaining = remaining.flatMap((a) => {
      if (!intersects(a, r)) return [a]
      if (contains(r, a)) return []
      const top = Math.max(a.top, r.top), bottom = Math.min(a.bottom, r.bottom)
      return [
        { ...a, bottom: top - 1 }, { ...a, top: bottom + 1 },
        { top, bottom, left: a.left, right: r.left - 1 },
        { top, bottom, left: r.right + 1, right: a.right },
      ].filter((piece) => piece.top <= piece.bottom && piece.left <= piece.right)
    })
    if (!remaining.length) return true
  }
  return !remaining.length
}

export interface ArrayWriteOptions {
  insert?: { kind: 'row' | 'col'; at: number }
  /** Sorting cannot relocate even a whole array, or a formula that might start spilling. */
  sort?: { values?: SheetValues; value: (row: number, col: number) => CellValue }
}

/** All interactive content writes preflight here, before any mutation. Dynamic spills may be
 * obstructed by ordinary edits (Excel shows #SPILL! until the obstruction is cleared). */
export function assertArrayWrite(sheet: SheetModel, ranges: CellRange[], options: ArrayWriteOptions = {}): void {
  sheet.forEachCell((row, col, data) => {
    if (data.array) {
      const array = { top: row, left: col, bottom: row + data.array.rows - 1, right: col + data.array.cols - 1 }
      if (options.insert) {
        const { kind, at } = options.insert
        if (kind === 'row' ? at > array.top && at <= array.bottom : at > array.left && at <= array.right) throw new DataOperationError('partialArray')
      }
      if (ranges.some((r) => intersects(r, array))) {
        if (options.sort) throw new DataOperationError('arrays')
        if (!covered(array, ranges)) throw new DataOperationError('partialArray')
      }
    }
    const sort = options.sort
    if (!sort) return
    const size = data.array ?? sort.values?.spill?.(sheet, row, col) ?? (data.spillCache ? { rows: data.spillCache.length, cols: data.spillCache[0]?.length ?? 1 } : undefined)
    const potential = data.oversizedArray || data.dynamic && !sort.values?.spill
    const array = size ? { top: row, left: col, bottom: row + size.rows - 1, right: col + size.cols - 1 } : potential ? { top: row, left: col, bottom: MAX_ROWS - 1, right: MAX_COLS - 1 } : undefined
    if (array && ranges.some((r) => intersects(r, array))) throw new DataOperationError('arrays')
    if (!data.dynamic || !ranges.some((r) => rangeContains(r, row, col))) return
    const value = sort.value(row, col)
    if (isErrorValue(value) && value.e === '#SPILL!') throw new DataOperationError('arrays')
    if (data.f !== undefined) {
      const parsed = parseFormula(toA1Form(data.f, sheet))
      if (!parsed.ok || !alwaysScalar(parsed.ast)) throw new DataOperationError('arrays')
    }
  })
}

/** A currently scalar dynamic formula can start spilling after relocation (e.g. IF(ROW(),…)). */
function alwaysScalar(node: Node): boolean {
  switch (node.type) {
    case 'number': case 'string': case 'bool': case 'error': return true
    case 'ref': return node.ref.kind === 'cell'
    case 'paren': return alwaysScalar(node.expr)
    case 'unary': return alwaysScalar(node.operand)
    case 'postfix': return node.op === '%' && alwaysScalar(node.operand)
    case 'binary': return ![':', ' ', ','].includes(node.op) && alwaysScalar(node.left) && alwaysScalar(node.right)
    case 'call': return !node.sheet && ['SUM', 'PRODUCT', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTBLANK', 'AVERAGE', 'MEDIAN', 'AND', 'OR'].includes(node.name)
    default: return false
  }
}
