import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { MemoryLiveAssetStore } from '../../assets.js'
import { writeXlsx } from '../codec/write-xlsx.js'
import { libreOfficeAvailable, libreOfficeConvert } from '../testing/fidelity.js'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MAX_COLS, MAX_ROWS, parseRangeList } from '../address.js'
import { SheetCalc } from '../calc.js'
import { toIdForm } from '../model/formula-ids.js'
import type { ConditionalRule } from '../model/schema.js'
import { WorkbookModel } from '../model/workbook.js'
import { Stylesheet } from '../styles/stylesheet.js'
import { CachedValues } from '../values.js'
import { DEFAULT_THEME_COLORS } from './colors.js'
import { ConditionalFormatter } from './conditional.js'
import { currentRegion } from './current-region.js'

const styles = new Stylesheet('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dxfs count="1"><dxf><font><b/></font></dxf></dxfs></styleSheet>')
function fixture() {
  const book = WorkbookModel.initialize(new Y.Doc())
  const sheet = book.addSheet('Sheet1')
  return { book, sheet }
}

const rules: ConditionalRule[] = [
  { type: 'duplicateValues', priority: 1, dxfId: 0 },
  { type: 'colorScale', priority: 1, colorScale: { values: [{ type: 'min' }, { type: 'max' }], colors: [{ rgb: 'FFFFFFFF' }, { rgb: 'FF000000' }] } },
  { type: 'top10', priority: 1, dxfId: 0, rank: 1 },
  { type: 'aboveAverage', priority: 1, dxfId: 0 },
]

describe.each(['rows', 'columns'] as const)('sparse full-domain CF across %s', (axis) => {
  it.each(rules)('includes distant cells in $type and refreshes cached statistics', (rule) => {
    const { book, sheet } = fixture()
    const far = axis === 'rows' ? { row: 100_002, col: 0 } : { row: 0, col: 1002 }
    sheet.setCell(0, 0, { v: 10 })
    sheet.setCell(far.row, far.col, { v: rule.type === 'duplicateValues' ? 10 : 100 })
    // Overlap must not count the first value twice; an unrelated cell must be excluded.
    sheet.setCell(1, 2, { v: 10000 })
    const domain = axis === 'rows' ? { top: 0, left: 0, bottom: MAX_ROWS - 1, right: 0 } : { top: 0, left: 0, bottom: 0, right: MAX_COLS - 1 }
    sheet.cf.set('rule', { ranges: [sheet.rangeIds(domain), sheet.rangeIds({ top: 0, left: 0, bottom: 0, right: 0 })], rules: [rule] })
    const values = new CachedValues(book)
    const get = vi.spyOn(values, 'get')
    const formatter = new ConditionalFormatter(sheet, values, styles, DEFAULT_THEME_COLORS)
    const unsubscribe = values.subscribe(() => formatter.invalidate())
    try {
      const first = formatter.overlay(0, 0)
      const last = formatter.overlay(far.row, far.col)
      if (rule.type === 'duplicateValues') { expect(first?.style?.font?.bold).toBe(true); expect(last?.style?.font?.bold).toBe(true) }
      else if (rule.type === 'colorScale') { expect(first?.scaleColor).toBe('#FFFFFF'); expect(last?.scaleColor).toBe('#000000') }
      else { expect(first).toBeUndefined(); expect(last?.style?.font?.bold).toBe(true) }
      // The budget depends on population, not the million-row/16k-column domain.
      expect(get.mock.calls.length).toBeLessThan(10)
      formatter.overlay(0, 0)
      expect(get.mock.calls.length).toBeLessThan(10)
      sheet.setCell(far.row, far.col, { v: rule.type === 'duplicateValues' ? 11 : 1 })
      const changed = formatter.overlay(0, 0)
      if (rule.type === 'duplicateValues') expect(changed).toBeUndefined()
      else if (rule.type === 'colorScale') expect(changed?.scaleColor).toBe('#000000')
      else expect(changed?.style?.font?.bold).toBe(true)
      sheet.setCell(far.row, far.col, undefined)
      expect(formatter.overlay(far.row, far.col)).toBeUndefined()
    } finally { unsubscribe(); values.destroy() }
  })
})

it.each(['expression', 'cellIs', 'colorScale', 'dataBar', 'iconSet'] as const)('translates %s formulas across multiple rectangles', (type) => {
  const { book, sheet } = fixture()
  sheet.setCell(0, 0, { v: 1 }); sheet.setCell(0, 1, { v: 2 })
  sheet.setCell(4, 0, { v: 100 }); sheet.setCell(4, 1, { v: 50 })
  sheet.setCell(4, 2, { v: 75 }); sheet.setCell(5, 2, { v: 0 })
  const id = (formula: string) => toIdForm(formula, sheet)
  const rule: ConditionalRule = type === 'expression' ? { type, priority: 1, dxfId: 0, formulas: [id('$A1>B1')] }
    : type === 'cellIs' ? { type, priority: 1, dxfId: 0, operator: 'between', formulas: [id('B1'), id('$A1')] }
    : type === 'colorScale' ? { type, priority: 1, colorScale: { values: [{ type: 'formula', value: id('B1') }, { type: 'formula', value: id('$A1') }], colors: [{ rgb: 'FFFFFFFF' }, { rgb: 'FF000000' }] } }
    : type === 'dataBar' ? { type, priority: 1, dataBar: { values: [{ type: 'formula', value: id('B1') }, { type: 'formula', value: id('$A1') }], color: { rgb: 'FF000000' }, minLength: 0, maxLength: 100 } }
    : { type, priority: 1, iconSet: { set: '3Arrows', values: [{ type: 'num', value: '0' }, { type: 'formula', value: id('B1') }, { type: 'formula', value: id('$A1') }] } }
  sheet.cf.set('rule', { ranges: parseRangeList('C1:C2 C5:C6').map((range) => sheet.rangeIds(range)), rules: [rule] })
  const calc = new SheetCalc(book)
  try {
    const formatter = new ConditionalFormatter(sheet, calc, styles, DEFAULT_THEME_COLORS)
    const overlay = formatter.overlay(4, 2)
    if (type === 'expression' || type === 'cellIs') expect(overlay?.style?.font?.bold).toBe(true)
    else if (type === 'colorScale') expect(overlay?.scaleColor).toBe('#808080')
    else if (type === 'dataBar') expect(overlay?.dataBar?.fraction).toBe(0.5)
    else expect(overlay?.icon?.index).toBe(1)
  } finally { calc.destroy() }
})

it('includes spill members in statistics and drops them after recalculation', () => {
  const { book, sheet } = fixture()
  sheet.setCell(100_002, 0, { f: 'SEQUENCE(2,1,10,0)', dynamic: true })
  sheet.cf.set('rule', { ranges: parseRangeList('A:A').map((range) => sheet.rangeIds(range)), rules: [rules[0]!] })
  const calc = new SheetCalc(book)
  const formatter = new ConditionalFormatter(sheet, calc, styles, DEFAULT_THEME_COLORS)
  const unsubscribe = calc.subscribe(() => formatter.invalidate())
  try {
    expect(formatter.overlay(100_003, 0)?.style?.font?.bold).toBe(true)
    sheet.setCell(100_002, 0, { v: 10 })
    expect(formatter.overlay(100_002, 0)).toBeUndefined()
    expect(formatter.overlay(100_003, 0)).toBeUndefined()
  } finally { unsubscribe(); calc.destroy() }
})

it('grows a populated region beyond 10,000 rows without scanning its empty bounding box', () => {
  const { book, sheet } = fixture()
  book.transact(() => { for (let row = 0; row < 10_010; row++) sheet.setCell(row, 0, { v: row }) })
  const values = new CachedValues(book)
  try { expect(currentRegion(sheet, values, 0, 0)).toEqual({ top: 0, left: 0, bottom: 10_009, right: 0 }) }
  finally { values.destroy() }
})

// PDF text colors exercise Calc's actual per-cell CF evaluation, not just XML preservation.
it.skipIf(process.env.PULPO_OFFICE_FIDELITY !== '1' || !libreOfficeAvailable())('agrees with LibreOffice on mixed-reference CF across a multi-rectangle sqref', async () => {
  const { book, sheet } = fixture()
  const xml = '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><cellXfs count="1"><xf/></cellXfs><dxfs count="1"><dxf><font><color rgb="FFFF0000"/></font></dxf></dxfs></styleSheet>'
  book.setMeta('stylesXml', xml)
  const rows = [[20, 5, 25, 12], [1, 10, 26, 13], [], [], [40, 30, 35, 36]]
  rows.forEach((line, row) => line.forEach((v, col) => sheet.setCell(row, col, { v })))
  sheet.cf.set('rule', { ranges: parseRangeList('C1:D2 C5:D5').map((range) => sheet.rangeIds(range)), rules: [{ type: 'expression', priority: 1, dxfId: 0, formulas: [toIdForm('$A1>B1', sheet)] }] })
  const work = mkdtempSync(join(tmpdir(), 'pulpo-cf-oracle-'))
  const calc = new SheetCalc(book)
  try {
    const file = join(work, 'rules.xlsx')
    writeFileSync(file, await writeXlsx(book.doc, new MemoryLiveAssetStore()))
    const result = libreOfficeConvert(file, 'pdf', join(work, 'pdf'))
    expect(result.ok).toBe(true)
    const output = join(work, 'colors.xml')
    execFileSync('pdftohtml', ['-xml', '-hidden', '-i', result.outputs![0]!, output], { timeout: 30_000 })
    const pdf = new DOMParser().parseFromString(readFileSync(output, 'utf8'), 'text/xml')
    const fonts = new Map([...Array.from(pdf.getElementsByTagName('fontspec'))].map((font) => [font.getAttribute('id'), font.getAttribute('color')]))
    const colors = new Map(Array.from(pdf.getElementsByTagName('text')).map((text) => [text.textContent?.trim(), fonts.get(text.getAttribute('font'))]))
    const formatter = new ConditionalFormatter(sheet, calc, new Stylesheet(xml), DEFAULT_THEME_COLORS)
    for (const [row, col, red] of [[0, 2, true], [0, 3, false], [1, 2, false], [1, 3, false], [4, 2, true], [4, 3, true]] as const) {
      const value = String(rows[row]![col])
      expect(colors.get(value), `Calc color for ${value}`).toBe(red ? '#ff0000' : '#000000')
      expect(formatter.overlay(row, col)?.style?.font?.fontColor?.rgb === 'FFFF0000').toBe(red)
    }
  } finally { calc.destroy(); rmSync(work, { recursive: true, force: true }) }
}, 120_000)

it('does not expand unsupported oversized-array metadata into blank statistics', () => {
  const { book, sheet } = fixture()
  sheet.setCell(0, 0, { f: 'UNKNOWN()', v: 7, oversizedArray: true, array: { rows: MAX_ROWS, cols: MAX_COLS } })
  sheet.setCell(100_002, 0, { v: 7 })
  sheet.cf.set('rule', { ranges: parseRangeList('A:A').map((range) => sheet.rangeIds(range)), rules: [rules[0]!] })
  const values = new CachedValues(book)
  const get = vi.spyOn(values, 'get')
  try {
    const formatter = new ConditionalFormatter(sheet, values, styles, DEFAULT_THEME_COLORS)
    expect(formatter.overlay(0, 0)?.style?.font?.bold).toBe(true)
    expect(get.mock.calls.length).toBeLessThan(5)
  } finally { values.destroy() }
})
