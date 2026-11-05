import type * as Y from 'yjs'
import { cellName } from '../address.js'
import { isErrorValue, storedValue, type CellValue } from '../values.js'
import { toA1Form } from '../model/formula-ids.js'
import { WorkbookModel, type SheetModel } from '../model/workbook.js'
import { formatValue } from '../numfmt/index.js'
import { Stylesheet } from '../styles/stylesheet.js'
import { cellStyleIndex } from './write-worksheet.js'

/**
 * Plain text of a workbook for agents, search, and grep: each sheet's values as tab-separated
 * lines (formatted as displayed), then its formulas as `A1: =SUM(…)` lines so they can be found.
 */
export function sheetsToText(doc: Y.Doc, valueOf?: (sheet: SheetModel, row: number, col: number) => CellValue): string {
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
            // Results spilled by dynamic-array formulas show too.
            const spilled = valueOf?.(sheet, row, col) ?? null
            fields.push(spilled === null ? '' : isErrorValue(spilled) ? spilled.e : formatValue(spilled, 'General', { date1904: model.date1904 }).text)
            continue
          }
          if (data.f !== undefined) formulas.push(`${cellName(row, col)}: =${toA1Form(data.f, sheet)}`)
          const computed = valueOf ? valueOf(sheet, row, col) : storedValue(data)
          const value = isErrorValue(computed) ? computed.e : computed
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
