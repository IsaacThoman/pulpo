import type { RangeIds, SheetTable } from '../model/schema.js'
import type { SheetModel, WorkbookModel } from '../model/workbook.js'

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

/** Calculation and export must resolve colliding table names in the same canonical order. */
export function resolvedTables(workbook: WorkbookModel): Map<string, [string, SheetTable][]> {
  const sheets = workbook.sheets()
  const used = new Set([...workbook.names.values()].map((name) => name.name.toLowerCase()))
  const reserved = new Set([...used, ...sheets.flatMap((sheet) => [...sheet.tables.values()].map((raw) => (raw as SheetTable).name.toLowerCase()))])
  return new Map(sheets.map((sheet) => [sheet.id, orderedEntries(sheet, sheet.tables, (raw) => (raw as SheetTable).range).map(([id, raw]): [string, SheetTable] => {
    const table = raw as SheetTable
    let name = table.name
    if (used.has(name.toLowerCase())) {
      let suffix = 2
      do { name = `${table.name}_${suffix++}` } while (reserved.has(name.toLowerCase()))
    }
    reserved.add(name.toLowerCase())
    used.add(name.toLowerCase())
    return [id, { ...table, name, displayName: name === table.name ? table.displayName : name }]
  })]))
}
