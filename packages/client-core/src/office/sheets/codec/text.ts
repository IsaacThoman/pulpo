import type * as Y from 'yjs'
import { cellName } from '../address.js'
import { toA1Form } from '../model/formula-ids.js'
import type { CellData } from '../model/schema.js'
import { WorkbookModel, type SheetModel } from '../model/workbook.js'
import { formatValue } from '../numfmt/index.js'
import { Stylesheet } from '../styles/stylesheet.js'
import { cellStyleIndex } from './write-worksheet.js'

/**
 * Plain text of a workbook for agents, search, and grep: each sheet's values as tab-separated
 * lines (formatted as displayed), then its formulas as `A1: =SUM(…)` lines so they can be found.
 */
export function sheetsToText(doc: Y.Doc, display?: (sheet: SheetModel, row: number, col: number, data: CellData) => string | undefined): string {
  const model = new WorkbookModel(doc)
  if (!model.initialized) return ''
  const styles = new Stylesheet(model.metaValue('stylesXml'))
  const csv = model.metaValue('format') === 'csv' || model.metaValue('format') === 'tsv'
  const sections: string[] = []
  for (const sheet of model.sheets()) {
    const used = sheet.usedRange()
    const lines: string[] = []
    const formulas: string[] = []
    if (used) {
      for (let row = used.top; row <= used.bottom; row++) {
        const fields: string[] = []
        for (let col = 0; col <= used.right; col++) {
          const key = sheet.keyAt(row, col)
          const data = sheet.cells.get(key)
          if (!data) {
            fields.push('')
            continue
          }
          if (data.f !== undefined) formulas.push(`${cellName(row, col)}: =${toA1Form(data.f, sheet)}`)
          const shown = display?.(sheet, row, col, data)
          if (shown !== undefined) {
            fields.push(shown)
            continue
          }
          const value = data.t === 'e' ? String(data.v) : (data.v ?? null)
          const xf = cellStyleIndex(sheet, styles, sheet.rows.idAt(row), sheet.cols.idAt(col), key)
          // CSV fields keep their text as written (without the quotes they were read with).
          const raw = data.raw?.startsWith('"') ? undefined : data.raw
          fields.push(raw ?? formatValue(value, styles.resolve(xf).numFmt, { date1904: model.date1904 }).text)
        }
        lines.push(fields.join('\t').replace(/\t+$/, ''))
      }
    }
    if (csv) return lines.join('\n')
    let section = `## ${sheet.name}${sheet.state !== 'visible' ? ` (${sheet.state})` : ''}\n${lines.join('\n')}`
    if (formulas.length) section += `\n\nFormulas in ${sheet.name}:\n${formulas.join('\n')}`
    sections.push(section)
  }
  return sections.join('\n\n')
}
