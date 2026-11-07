import type * as Y from 'yjs'
import { cellName } from '../address.js'
import { isErrorValue, storedValue, type CellValue } from '../values.js'
import { toA1Form } from '../model/formula-ids.js'
import { WorkbookModel, type SheetModel } from '../model/workbook.js'
import { formatValue } from '../numfmt/index.js'
import { Stylesheet } from '../styles/stylesheet.js'
import { cellStyleIndex } from './write-worksheet.js'

/** Past this many grid positions a sheet is listed cell by cell instead of as a grid. */
const MAX_GRID_CELLS = 2_000_000
const MAX_GRID_ROWS = 50_000

/**
 * Plain text of a workbook for agents, search, and grep: each sheet's values as tab-separated
 * lines (formatted as displayed), then its formulas as `A1: =SUM(…)` lines so they can be found.
 * Sparse sheets whose cells lie far apart are listed as `B7: value` lines instead of a grid.
 */
export function sheetsToText(doc: Y.Doc, valueOf?: (sheet: SheetModel, row: number, col: number) => CellValue): string {
  const model = new WorkbookModel(doc)
  if (!model.initialized) return ''
  const styles = new Stylesheet(model.metaValue('stylesXml'))
  const csv = model.metaValue('format') === 'csv' || model.metaValue('format') === 'tsv'
  const sections: string[] = []
  const shown = (sheet: SheetModel, row: number, col: number): string => {
    const key = sheet.keyAt(row, col)
    const data = sheet.cellData(key)
    if (!data) {
      // Results spilled by dynamic-array formulas show too.
      const spilled = valueOf?.(sheet, row, col) ?? null
      return spilled === null ? '' : isErrorValue(spilled) ? spilled.e : formatValue(spilled, 'General', { date1904: model.date1904 }).text
    }
    // CSV fields keep their text as written (without the quotes they were read with).
    const raw = data.raw?.startsWith('"') ? undefined : data.raw
    if (raw !== undefined) return raw
    const computed = valueOf ? valueOf(sheet, row, col) : storedValue(data)
    if (isErrorValue(computed)) return computed.e
    const xf = cellStyleIndex(sheet, styles, sheet.rows.idAt(row), sheet.cols.idAt(col), key)
    return formatValue(computed, styles.resolve(xf).numFmt, { date1904: model.date1904 }).text
  }
  for (const sheet of model.sheets()) {
    // Cells by row, from what is stored (never by walking the whole used rectangle).
    const rows = new Map<number, number[]>()
    const formulas: { row: number; col: number; text: string }[] = []
    sheet.forEachCell((row, col, data) => {
      let cols = rows.get(row)
      if (!cols) rows.set(row, (cols = []))
      cols.push(col)
      if (data.f !== undefined) formulas.push({ row, col, text: `${cellName(row, col)}: =${toA1Form(data.f, sheet)}` })
    })
    const used = sheet.usedRange()
    const lines: string[] = []
    if (used) {
      const sortedRows = [...rows.keys()].sort((a, b) => a - b)
      const height = used.bottom - used.top + 1
      const width = used.right + 1
      if (height <= MAX_GRID_ROWS && height * width <= MAX_GRID_CELLS) {
        for (let row = used.top; row <= used.bottom; row++) {
          const cols = rows.get(row)
          if (!cols && !valueOf) {
            lines.push('')
            continue
          }
          const last = (cols ?? []).reduce((max, col) => Math.max(max, col), 0)
          // Spilled results can reach past the stored cells of a row.
          const end = valueOf ? width - 1 : last
          const fields: string[] = []
          for (let col = 0; col <= end; col++) fields.push(shown(sheet, row, col))
          lines.push(fields.join('\t').replace(/\t+$/, ''))
        }
      } else {
        for (const row of sortedRows) {
          for (const col of rows.get(row)!.sort((a, b) => a - b)) {
            const text = shown(sheet, row, col)
            if (text !== '') lines.push(`${cellName(row, col)}: ${text}`)
          }
        }
      }
    }
    if (csv) return lines.join('\n')
    formulas.sort((a, b) => a.row - b.row || a.col - b.col)
    let section = `## ${sheet.name}${sheet.state !== 'visible' ? ` (${sheet.state})` : ''}\n${lines.join('\n')}`
    if (formulas.length) section += `\n\nFormulas in ${sheet.name}:\n${formulas.map((formula) => formula.text).join('\n')}`
    sections.push(section)
  }
  return sections.join('\n\n')
}
