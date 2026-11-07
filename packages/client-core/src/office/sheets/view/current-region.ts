import { MAX_COLS, MAX_ROWS, type CellRange } from '../address.js'
import type { SheetModel } from '../model/workbook.js'
import { forEachPopulatedValue, type SheetValues } from '../values.js'

/** Grow through populated borders using sparse row/column indexes, without an iteration cutoff. */
export function currentRegion(sheet: SheetModel, values: SheetValues, row: number, col: number): CellRange {
  const rows = new Map<number, number[]>()
  const cols = new Map<number, number[]>()
  const add = (map: Map<number, number[]>, key: number, value: number) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }
  forEachPopulatedValue(sheet, values, [{ top: 0, left: 0, bottom: MAX_ROWS - 1, right: MAX_COLS - 1 }], (r, c) => {
    add(rows, r, c)
    add(cols, c, r)
  })
  for (const map of [rows, cols]) for (const list of map.values()) list.sort((a, b) => a - b)
  const any = (list: number[] | undefined, low: number, high: number) => {
    if (!list) return false
    let start = 0, end = list.length
    while (start < end) {
      const mid = (start + end) >>> 1
      if (list[mid]! < low) start = mid + 1
      else end = mid
    }
    return start < list.length && list[start]! <= high
  }
  const range = { top: row, left: col, bottom: row, right: col }
  while (true) {
    if (any(rows.get(range.top - 1), range.left - 1, range.right + 1)) range.top--
    else if (any(rows.get(range.bottom + 1), range.left - 1, range.right + 1)) range.bottom++
    else if (any(cols.get(range.left - 1), range.top - 1, range.bottom + 1)) range.left--
    else if (any(cols.get(range.right + 1), range.top - 1, range.bottom + 1)) range.right++
    else return range
  }
}
