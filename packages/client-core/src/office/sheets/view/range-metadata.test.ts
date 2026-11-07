import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { parseRangeName, rangeContains, rangeName, type CellRange } from '../address.js'
import { readXlsx } from '../codec/read-xlsx.js'
import { writeXlsx } from '../codec/write-xlsx.js'
import { toA1Form, toIdForm } from '../model/formula-ids.js'
import { clearRules } from '../model/range-metadata.js'
import { moveCells } from '../model/move-cells.js'
import { deleteAxis, insertAxis } from '../model/structure.js'
import type { ConditionalFormat, DataValidation, Hyperlink } from '../model/schema.js'
import { WorkbookModel, type SheetModel } from '../model/workbook.js'
import { fidelityAvailable, fidelityPython, libreOfficeAvailable, libreOfficeConvert } from '../testing/fidelity.js'
import { pasteRules } from './clipboard-state.js'
import { applyStyle, clearAll, clearFormats, mergeRanges, setConditionalFormat, setLink, setRangeLinks, setValidation, sortRange, unmergeRanges, validationAt } from './commands.js'
import { cellStyle } from '../styles/cell-style.js'
import { Stylesheet } from '../styles/stylesheet.js'

const rect = (text: string) => parseRangeName(text)!
function fixture() {
  const doc = new Y.Doc(), model = WorkbookModel.initialize(doc, { format: 'xlsx' }), sheet = model.addSheet('Sheet1')
  return { doc, model, sheet, assets: new MemoryLiveAssetStore() }
}
function ranges(sheet: SheetModel, kind: 'cf' | 'dv'): string[][] {
  return [...sheet[kind].values()].map((raw) => (raw as DataValidation).ranges.map((r) => rangeName(sheet.resolveRange(r)!)))
}
function formulas(sheet: SheetModel, kind: 'cf' | 'dv'): string[][] {
  return [...sheet[kind].values()].map((raw) => {
    const rule = raw as ConditionalFormat | DataValidation
    return ('rules' in rule ? rule.rules.flatMap((r) => r.formulas ?? []) : [rule.formula1!, rule.formula2!].filter(Boolean)).map((f) => toA1Form(f, sheet, sheet.workbook, { followDeletedRelative: true }))
  })
}
const cases = [
  ['middle', ['A5'], ['A1:A4', 'A6:A10']],
  ['first', ['A1:A3'], ['A4:A10']],
  ['last', ['A9:A10'], ['A1:A8']],
  ['multiple overlapping selections', ['A2:A4', 'A3:A6', 'A9'], ['A1', 'A7:A8', 'A10']],
  ['all', ['A1:A10'], []],
  ['outside', ['B1:B10'], ['A1:A10']],
] as const

for (const kind of ['dv', 'cf'] as const) describe(`${kind} selection coverage`, () => {
  const set = (sheet: SheetModel, selection: CellRange[], replacement: boolean) => kind === 'dv'
    ? setValidation(sheet, selection, replacement ? { type: 'list', formula1: '"new"' } : undefined)
    : setConditionalFormat(sheet, selection, replacement ? { rules: [{ type: 'expression', priority: 1, formulas: ['FALSE'] }] } : undefined)
  it.each(cases)('clears %s', (_name, cuts, expected) => {
    const { sheet } = fixture()
    if (kind === 'dv') setValidation(sheet, [rect('A1:A10')], { type: 'list', formula1: '"old"' })
    else setConditionalFormat(sheet, [rect('A1:A10')], { rules: [{ type: 'expression', priority: 1, formulas: ['TRUE'] }] })
    set(sheet, cuts.map(rect), false)
    expect(ranges(sheet, kind)).toEqual(expected.length ? [[...expected]] : [])
  })
  it.each(cases)('replaces %s without overlapping old rules', (_name, cuts, expected) => {
    const { sheet } = fixture()
    if (kind === 'dv') setValidation(sheet, [rect('A1:A10')], { type: 'list', formula1: '"old"' })
    else setConditionalFormat(sheet, [rect('A1:A10')], { rules: [{ type: 'expression', priority: 1, formulas: ['TRUE'] }] })
    set(sheet, cuts.map(rect), true)
    expect(ranges(sheet, kind).slice(0, expected.length ? 1 : 0)).toEqual(expected.length ? [[...expected]] : [])
    for (let row = 0; row < 10; row++) for (let col = 0; col < 2; col++) {
      const covering = [...sheet[kind].values()].filter((raw) => (raw as DataValidation).ranges.some((r) => rangeContains(sheet.resolveRange(r)!, row, col)))
      expect(covering.length).toBe(col === 0 || cuts.some((c) => rangeContains(rect(c), row, col)) ? 1 : 0)
    }
    if (kind === 'dv' && cuts.some((cut) => cut === 'A5')) expect(validationAt(sheet, 4, 0)?.formula1).toBe('"new"')
  })
  it('rebases mixed relative/absolute formulas, including scale thresholds, when the first cell is removed', () => {
    const { sheet } = fixture()
    const formula = toIdForm('B1+$C$1+D$1+$E1', sheet)
    if (kind === 'dv') sheet.dv.set('old', { ranges: [sheet.rangeIds(rect('A1:A10'))], type: 'custom', formula1: formula, formula2: formula })
    else sheet.cf.set('old', { ranges: [sheet.rangeIds(rect('A1:A10'))], rules: [{ type: 'expression', priority: 1, xml: '<cfRule/>', formulas: [formula], dataBar: { values: [{ type: 'formula', value: formula }], color: { rgb: 'FF0000' } } }] })
    set(sheet, [rect('A1:A3')], false)
    expect(formulas(sheet, kind)[0]).toEqual(kind === 'dv' ? ['B4+$C$1+D$1+$E4', 'B4+$C$1+D$1+$E4'] : ['B4+$C$1+D$1+$E4'])
    if (kind === 'cf') {
      const cf = sheet.cf.get('old') as ConditionalFormat
      expect(cf.rules[0]?.xml).toBe('<cfRule/>')
      expect(toA1Form(cf.rules[0]!.dataBar!.values[0]!.value!, sheet)).toBe('B4+$C$1+D$1+$E4')
    }
  })
  it('keeps split coverage positional across row/column insertions, deletions and a record sort', () => {
    const { sheet } = fixture()
    const rule = { ranges: [sheet.rangeIds(rect('B2:D10'))] }
    sheet[kind].set('old', kind === 'dv' ? { ...rule, type: 'custom', formula1: toIdForm('C2>0', sheet) } : { ...rule, rules: [{ type: 'expression', priority: 1, formulas: [toIdForm('C2>0', sheet)] }] })
    set(sheet, [rect('B6:D6')], false)
    expect((sheet[kind].get('old') as DataValidation).ranges.every((r) => r.top?.startsWith('~p') && r.bottom?.startsWith('~p'))).toBe(true)
    insertAxis(sheet, 'row', 2, 1)
    deleteAxis(sheet, 'row', 8, 1)
    insertAxis(sheet, 'col', 2, 1)
    deleteAxis(sheet, 'col', 1, 1)
    const expected = [['B2:D6', 'B8:D10']]
    expect(ranges(sheet, kind)).toEqual(expected)
    for (let row = 0; row < 12; row++) sheet.setCell(row, 0, { v: 12 - row })
    sortRange(sheet, rect('A1:E12'), [{ col: 0 }], (r, c) => sheet.cell(r, c)?.v ?? null)
    expect(ranges(sheet, kind)).toEqual(expected)
    expect(formulas(sheet, kind)).toEqual([['C2>0']])
    // Editing an already positional rule must not turn its survivors back into record anchors.
    set(sheet, [rect('B2:D2')], false)
    sortRange(sheet, rect('A1:E12'), [{ col: 0, descending: true }], (r, c) => sheet.cell(r, c)?.v ?? null)
    expect(ranges(sheet, kind)).toEqual([['B3:D6', 'B8:D10']])
    expect(formulas(sheet, kind)).toEqual([['C3>0']])
  })
})

it('clears CF through Clear Formats and preserves Excel additive rule domains', () => {
  const { sheet } = fixture()
  const format: Omit<ConditionalFormat, 'ranges'> = { rules: [{ type: 'top10', priority: 1, rank: 3 }] }
  setConditionalFormat(sheet, [rect('A1:A10')], format)
  setConditionalFormat(sheet, [rect('A5')], { rules: [{ type: 'expression', priority: 2, formulas: ['TRUE'] }] }, 'add')
  expect(ranges(sheet, 'cf')).toEqual([['A1:A10'], ['A5']])
  clearFormats(sheet, [rect('A5')])
  expect(ranges(sheet, 'cf')).toEqual([['A1:A4', 'A6:A10']])
  expect((sheet.cf.values().next().value as ConditionalFormat).rules[0]?.rank).toBe(3)
})

it('pastes rules over part of an existing domain and rebases both anchors', () => {
  const { sheet } = fixture()
  for (const kind of ['cf', 'dv'] as const) {
    sheet[kind].set('old', kind === 'dv' ? { ranges: [sheet.rangeIds(rect('A1:A10'))], type: 'custom', formula1: toIdForm('B1>0', sheet) } : { ranges: [sheet.rangeIds(rect('A1:A10'))], rules: [{ type: 'expression', priority: 1, formulas: [toIdForm('B1>0', sheet)] }] })
    const value = kind === 'dv' ? { type: 'custom' as const, formula1: 'C1>0' } : { rules: [{ type: 'expression' as const, priority: 1, formulas: ['C1>0'] }] }
    const entry = { origin: { row: 0, col: 0 }, ranges: [rect('A1:A2')] }
    if (kind === 'dv') pasteRules<DataValidation>(sheet, kind, [{ ...entry, value: value as Omit<DataValidation, 'ranges'> }], rect('A1:A2'), [0, 1], [0])
    else pasteRules<ConditionalFormat>(sheet, kind, [{ ...entry, value: value as Omit<ConditionalFormat, 'ranges'> }], rect('A1:A2'), [0, 1], [0])
    expect(ranges(sheet, kind)).toEqual([['A3:A10'], ['A1:A2']])
    expect(formulas(sheet, kind)).toEqual([['B3>0'], ['C1>0']])
  }
})

describe('range hyperlinks', () => {
  it.each(cases)('removes %s and keeps the rest', (_name, cuts, expected) => {
    const { sheet } = fixture()
    sheet.links.set(sheet.keyAt(0, 0), { target: 'https://example.com/old', tooltip: 'kept', range: sheet.rangeIds(rect('A1:A10')) })
    setRangeLinks(sheet, cuts.map(rect), undefined)
    expect([...sheet.links.values()].map((l) => rangeName(sheet.resolveRange((l as Hyperlink).range!)!))).toEqual(expected)
    for (let row = 0; row < 10; row++) expect(sheet.linkAt(row, 0)?.target).toBe(expected.some((r) => rangeContains(rect(r), row, 0)) ? 'https://example.com/old' : undefined)
  })
  it.each(cases)('replaces %s', (_name, cuts) => {
    const { sheet } = fixture()
    setRangeLinks(sheet, [rect('A1:A10')], { location: 'Sheet1!C1' })
    setRangeLinks(sheet, cuts.map(rect), { target: 'https://example.com/new' })
    for (let row = 0; row < 10; row++) expect(sheet.linkAt(row, 0)).toMatchObject(cuts.some((r) => rangeContains(rect(r), row, 0)) ? { target: 'https://example.com/new' } : { location: 'Sheet1!C1' })
  })
  it('splits on a single-cell command and retains even singleton survivors during sort', () => {
    const { sheet } = fixture()
    setRangeLinks(sheet, [rect('A1:A3')], { target: 'https://example.com' })
    setLink(sheet, 1, 0, undefined)
    for (let r = 0; r < 3; r++) sheet.setCell(r, 0, { v: 3 - r })
    for (let pass = 0; pass < 2; pass++) {
      // Exercise both identity permutation and snapshot sorting with adjacent content.
      if (pass) sheet.setCell(0, 2, { v: 'beside' })
      sortRange(sheet, rect('A1:A3'), [{ col: 0, descending: !!pass }], (r, c) => sheet.cell(r, c)?.v ?? null)
      expect([0, 1, 2].map((r) => !!sheet.linkAt(r, 0))).toEqual([true, false, true])
    }
    insertAxis(sheet, 'row', 0, 1)
    deleteAxis(sheet, 'row', 2, 1)
    insertAxis(sheet, 'col', 0, 1)
    expect([0, 1, 2].map((r) => !!sheet.linkAt(r, 1))).toEqual([false, true, true])
  })
})

it.each([
  ['B2:C3', 'A1:B2', false], ['B2:C3', 'C3:D4', false], ['B2:C3', 'B2:B3', false],
  ['B2:C3', 'A1:D4', true], ['B2:C3', 'B2:C3', true], ['B2:C3', 'D1:E2', true],
] as const)('merge %s into %s is allowed=%s', (old, target, allowed) => {
  const { sheet } = fixture()
  mergeRanges(sheet, [rect(old)])
  sheet.setCell(0, 0, { v: 'keep' })
  const before = Y.encodeStateAsUpdate(sheet.workbook.doc)
  if (!allowed) {
    expect(() => mergeRanges(sheet, [rect('F1:G2'), rect(target)])).toThrow()
    expect(Y.encodeStateAsUpdate(sheet.workbook.doc)).toEqual(before)
  } else { mergeRanges(sheet, [rect(target)]); expect(sheet.mergedRanges().some((m) => rangeName(m.range) === target)).toBe(true) }
})
it('refuses across-merging a vertical merge, and unmerges whole cells intersected by selection', () => {
  const { sheet } = fixture()
  mergeRanges(sheet, [rect('A1:B2')])
  expect(() => mergeRanges(sheet, [rect('A1:C2')], 'across')).toThrow()
  unmergeRanges(sheet, [rect('B2')])
  expect(sheet.mergedRanges()).toEqual([])
})
it('locked ranges are styles and partial unlocking preserves adjacent cell/axis protection', () => {
  const { sheet } = fixture()
  applyStyle(sheet, [rect('A:A')], { locked: true })
  applyStyle(sheet, [rect('A5')], { locked: false })
  const styles = new Stylesheet(sheet.workbook.metaValue('stylesXml'))
  expect([3, 4, 5].map((r) => cellStyle(sheet, styles, r, 0).locked)).toEqual([true, false, true])
})
it('cutting into another sheet rebases the surviving destination rules', () => {
  const { sheet, model } = fixture(), other = model.addSheet('Other')
  setValidation(other, [rect('A1:A10')], { type: 'custom', formula1: toIdForm('B1>0', other) })
  sheet.setCell(0, 0, { v: 'moved' })
  moveCells(sheet, other, rect('A1:A2'), { row: 0, col: 0 })
  expect(ranges(other, 'dv')).toEqual([['A3:A10']])
  expect(formulas(other, 'dv')).toEqual([['B3>0']])
})

it('exports split sqref as a space-separated list and round-trips it through the codec and openpyxl', async () => {
  const { sheet, doc, assets } = fixture()
  setValidation(sheet, [rect('A1:A10')], { type: 'custom', formula1: toIdForm('B1>0', sheet) })
  setConditionalFormat(sheet, [rect('A1:A10')], { rules: [{ type: 'expression', priority: 1, formulas: [toIdForm('B1>0', sheet)] }] })
  setRangeLinks(sheet, [rect('A1:A10')], { target: 'https://example.com' })
  setValidation(sheet, [rect('A5')], undefined)
  clearRules(sheet, 'cf', rect('A5'))
  setLink(sheet, 4, 0, undefined)
  for (let row = 0; row < 10; row++) sheet.setCell(row, 0, { v: row + 1 })
  const bytes = await writeXlsx(doc, assets)
  const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!)
  expect(xml.match(/sqref="A1:A4 A6:A10"/g)?.length).toBe(2)
  const imported = new Y.Doc()
  await readXlsx(imported, bytes, assets)
  const result = new WorkbookModel(imported).sheets()[0]!
  expect(ranges(result, 'dv')).toEqual([['A1:A4', 'A6:A10']])
  expect(ranges(result, 'cf')).toEqual([['A1:A4', 'A6:A10']])
  expect([3, 4, 5].map((r) => !!result.linkAt(r, 0))).toEqual([true, false, true])
  if (fidelityAvailable()) {
    const work = mkdtempSync(join(tmpdir(), 'pulpo-range-metadata-'))
    try {
      const file = join(work, 'split.xlsx'); writeFileSync(file, bytes)
      const inspect = (path: string) => {
        const run = spawnSync(fidelityPython(), ['-I', '-c', `import json,sys,openpyxl
s=openpyxl.load_workbook(sys.argv[1]).active
print(json.dumps({'dv': [[str(d.sqref),d.formula1] for d in s.data_validations.dataValidation], 'cf': [[str(k.sqref),s.conditional_formatting[k][0].formula] for k in s.conditional_formatting], 'links':[bool(s.cell(r,1).hyperlink) for r in range(1,11)]}))`, path], { encoding: 'utf8' })
        expect(run.status, run.stderr).toBe(0)
        return JSON.parse(run.stdout)
      }
      const expected = { dv: [['A1:A4 A6:A10', 'B1>0']], cf: [['A1:A4 A6:A10', ['B1>0']]], links: [true, true, true, true, false, true, true, true, true, true] }
      expect(inspect(file)).toEqual(expected)
      if (process.env.PULPO_OFFICE_FIDELITY === '1' && libreOfficeAvailable()) {
        const converted = libreOfficeConvert(file, 'xlsx', join(work, 'lo'))
        expect(converted.ok).toBe(true)
        // Calc may split validation objects by rectangle; check cell coverage and rebased formulas.
        const lo = inspect(converted.outputs![0]!)
        expect(lo.links).toEqual(expected.links)
        const coverage = (entries: string[][]) => Array.from({ length: 10 }, (_, r) => entries.some(([refs]) => refs!.split(' ').some((ref) => rangeContains(rect(ref), r, 0))))
        expect(coverage(lo.dv)).toEqual(expected.links)
        expect(coverage(lo.cf)).toEqual(expected.links)
      }
    } finally { rmSync(work, { recursive: true, force: true }) }
  }
}, 180_000)

it.each(['dv', 'cf', 'link'] as const)('subtracts two-dimensional holes from %s selections', (kind) => {
  const { sheet } = fixture()
  if (kind === 'dv') {
    setValidation(sheet, [rect('A1:D4')], { type: 'list', formula1: '"old"' })
    setValidation(sheet, [rect('B2:C3')], undefined)
  } else if (kind === 'cf') {
    setConditionalFormat(sheet, [rect('A1:D4')], { rules: [{ type: 'expression', priority: 1, formulas: ['TRUE'] }] })
    setConditionalFormat(sheet, [rect('B2:C3')], undefined)
  } else {
    setRangeLinks(sheet, [rect('A1:D4')], { target: 'https://example.com' })
    setRangeLinks(sheet, [rect('B2:C3')], undefined)
  }
  const result = kind === 'link' ? [...sheet.links.values()].map((raw) => rangeName(sheet.resolveRange((raw as Hyperlink).range!)!)) : ranges(sheet, kind)[0]
  expect(result).toEqual(['A1:D1', 'A2:A3', 'D2:D3', 'A4:D4'])
})
it('Clear All subtracts validation and hyperlinks while retaining neighboring notes and rules', () => {
  const { sheet } = fixture()
  setValidation(sheet, [rect('A1:A10')], { type: 'list', formula1: '"old"' })
  setRangeLinks(sheet, [rect('A1:A10')], { target: 'https://example.com' })
  sheet.notes.set(sheet.keyAt(4, 0), { text: 'remove' })
  sheet.notes.set(sheet.keyAt(5, 0), { text: 'retain' })
  clearAll(sheet, [rect('A5')])
  expect(ranges(sheet, 'dv')).toEqual([['A1:A4', 'A6:A10']])
  expect(sheet.linkAt(4, 0)).toBeUndefined()
  expect(sheet.linkAt(5, 0)?.target).toBe('https://example.com')
  expect(sheet.notes.get(sheet.keyAt(4, 0))).toBeUndefined()
  expect(sheet.notes.get(sheet.keyAt(5, 0))).toEqual({ text: 'retain' })
})

it.each([false, true])('cut relocation splits partial source/destination hyperlinks, cross-sheet=%s', (cross) => {
  const { sheet, model } = fixture(), target = cross ? model.addSheet('Other') : sheet
  setRangeLinks(sheet, [rect('A1:A10')], { location: 'Sheet1!A5' })
  setRangeLinks(target, [rect('C1:C10')], { target: 'https://example.com/destination' })
  moveCells(sheet, target, rect('A4:A6'), { row: 3, col: 2 })
  for (let row = 0; row < 10; row++) {
    const moved = row >= 3 && row <= 5
    expect(sheet.linkAt(row, 0)?.location).toBe(moved ? undefined : `${cross ? 'Other' : 'Sheet1'}!C5`)
    if (moved) expect(target.linkAt(row, 2)?.location).toBe(`${cross ? 'Other' : 'Sheet1'}!C5`)
    else expect(target.linkAt(row, 2)?.target).toBe('https://example.com/destination')
  }
})

it.each(['dv', 'cf'] as const)('rebases %s after deleting the first surviving row and column', (kind) => {
  const { sheet } = fixture()
  const value = { ranges: [sheet.rangeIds(rect('B2:E10'))] }
  const formula = toIdForm('C2+$F$12', sheet)
  sheet[kind].set('old', kind === 'dv' ? { ...value, type: 'custom', formula1: formula } : { ...value, rules: [{ type: 'expression', priority: 1, formulas: [formula] }] })
  clearRules(sheet, kind, rect('B6:E6'))
  deleteAxis(sheet, 'row', 1, 1)
  expect(ranges(sheet, kind)).toEqual([['B2:E4', 'B6:E9']])
  expect(formulas(sheet, kind)).toEqual([['C2+$F$11']])
  deleteAxis(sheet, 'col', 1, 1)
  expect(ranges(sheet, kind)).toEqual([['B2:D4', 'B6:D9']])
  expect(formulas(sheet, kind)).toEqual([['B2+$E$11']])
  clearRules(sheet, kind, rect('B2:D2'))
  expect(formulas(sheet, kind)).toEqual([['B3+$E$11']])
})

it('preserves unknown conditional-rule XML when only its coverage/formula anchor changes', async () => {
  const { sheet, doc, assets } = fixture()
  const xml = '<cfRule xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" type="expression" priority="1" custom="kept"><formula>B1&gt;0</formula><extLst><ext uri="kept"/></extLst></cfRule>'
  sheet.cf.set('old', { ranges: [sheet.rangeIds(rect('A1:A10'))], rules: [{ type: 'expression', priority: 1, formulas: [toIdForm('B1>0', sheet)], xml }] })
  setConditionalFormat(sheet, [rect('A1:A3')], undefined)
  const output = strFromU8(unzipSync(await writeXlsx(doc, assets))['xl/worksheets/sheet1.xml']!)
  expect(output).toContain('sqref="A4:A10"')
  expect(output).toContain('<formula>B4&gt;0</formula>')
  expect(output).toContain('custom="kept"')
  expect(output).toContain('<ext uri="kept"/>')
})

it('refuses overlapping merge selections atomically', () => {
  const { sheet, doc } = fixture()
  sheet.setCell(0, 0, { v: 'keep' })
  const before = Y.encodeStateAsUpdate(doc)
  expect(() => mergeRanges(sheet, [rect('A1:B2'), rect('B2:C3')])).toThrow()
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
})
