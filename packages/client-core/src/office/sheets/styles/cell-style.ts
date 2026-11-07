import { columnIntervalProps } from '../model/column-intervals.js'
import type { SheetModel } from '../model/workbook.js'
import type { ResolvedStyle, Stylesheet } from './stylesheet.js'

/** Shared style precedence for display, typed input and clipboard consumers. */
export function cellStyle(sheet: SheetModel, styles: Stylesheet, row: number, col: number): ResolvedStyle {
  const key = sheet.keyAt(row, col)
  const base = sheet.xf.get(key) ?? sheet.rowProp(row, 'xf') ?? sheet.colProp(col, 'xf') ?? columnIntervalProps(sheet, col).xf
  return { ...styles.resolve(base), ...sheet.axisOverrides('col', sheet.cols.idAt(col)), ...sheet.axisOverrides('row', sheet.rows.idAt(row)), ...sheet.cellOverrides(key) }
}
