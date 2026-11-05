import type { RangeIds } from '../model/schema.js'
import type { SheetModel } from '../model/workbook.js'

/** Index assignment must use worksheet coordinates, independent of Y.Map insertion history. */
export function orderedEntries<T>(sheet: SheetModel, entries: Iterable<[string, T]>, range?: (value: T) => RangeIds | undefined): [string, T][] {
  return [...entries].map(([key, value]) => {
    const ids = range?.(value)
    const position = ids ? sheet.resolveRange(ids) : sheet.position(key)
    const row = position && ('top' in position ? position.top : position.row)
    const col = position && ('left' in position ? position.left : position.col)
    return { key, value, row: row ?? Infinity, col: col ?? Infinity }
  }).sort((a, b) => a.row - b.row || a.col - b.col || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map(({ key, value }) => [key, value])
}
