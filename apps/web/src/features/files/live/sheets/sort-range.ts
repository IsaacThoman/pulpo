import type { CellRange } from '@pulpo/client-core/office/sheets'
import { clampToUsed, type SheetView } from '@pulpo/client-core/office/sheets/view'

/** What a sort acts on: the selection, or the data around a single selected cell (as Sort A to Z does). */
export function sortArea(view: Pick<SheetView, 'selection' | 'sheet' | 'currentRegion'>): CellRange {
  const ranges = view.selection.ranges
  const range = ranges[ranges.length - 1]!
  if (range.top === range.bottom && range.left === range.right) return view.currentRegion(range.top, range.left)
  return clampToUsed(view.sheet, range)
}

/**
 * Whether the range's first row looks like headers: text over numbers (or bold text), the same
 * guess the toolbar's sort makes, so the dialog starts with what Sort A to Z would do.
 */
export function guessHeader(view: Pick<SheetView, 'valueAt' | 'styleAt'>, area: CellRange): boolean {
  if (area.bottom <= area.top) return false
  let text = 0
  let numbers = 0
  for (let col = area.left; col <= Math.min(area.right, area.left + 50); col++) {
    if (typeof view.valueAt(area.top, col) === 'string') text++
    if (typeof view.valueAt(area.top + 1, col) === 'number') numbers++
  }
  return text > 0 && (numbers > 0 || view.styleAt(area.top, area.left).bold)
}

/** The rows the sort moves: the header row (when there is one) stays where it is. */
export function sortedRows(area: CellRange, header: boolean): CellRange {
  return { ...area, top: area.top + (header && area.bottom > area.top ? 1 : 0) }
}
