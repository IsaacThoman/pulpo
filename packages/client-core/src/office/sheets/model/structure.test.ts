import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { strFromU8, unzipSync } from 'fflate'
import { MemoryLiveAssetStore } from '../../assets.js'
import { SheetCalc } from '../calc.js'
import { writeXlsx } from '../codec/write-xlsx.js'
import { readXlsx } from '../codec/read-xlsx.js'
import { anchorXml, keepReferencePart, resolveXml } from '../codec/reference-xml.js'
import { fidelityAvailable, fidelityPython, libreOfficeAvailable, libreOfficeConvert } from '../testing/fidelity.js'
import { moveCells } from './move-cells.js'
import { sortRange } from '../view/commands.js'
import { toA1Form, toIdForm } from './formula-ids.js'
import type { AutoFilter, DrawingObject, SheetTable } from './schema.js'
import { WorkbookModel } from './workbook.js'
import { deleteAxis, insertAxis, moveAxis } from './structure.js'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
function richWorkbook() {
  const doc = new Y.Doc()
  const model = WorkbookModel.initialize(doc, { format: 'xlsx' })
  const sheet = model.addSheet('Data')
  const other = model.addSheet('Results')
  sheet.workbook.transact(() => {
    for (let col = 0; col < 3; col++) {
      const name = ['A', 'B', 'C'][col]!
      sheet.setCell(0, col, { v: name })
      for (let row = 1; row < 6; row++) sheet.setCell(row, col, { v: row * 10 + col })
      sheet.setColProp([col], 'size', 15 + col)
    }
    sheet.tables.set('sales', {
      name: 'Sales', displayName: 'Sales', range: sheet.rangeIds({ top: 0, left: 0, bottom: 5, right: 2 }), headerRow: true, totalsRow: true,
      columns: ['A', 'B', 'C'].map((name, index) => ({ name, xml: anchorXml(`<tableColumn xmlns="${NS}" id="${index + 1}" name="${name}" totalsRowFunction="${['sum', 'average', 'max'][index]}"><calculatedColumnFormula>${name}2*${index + 1}</calculatedColumnFormula><totalsRowFormula>SUM(${name}2:${name}5)</totalsRowFormula></tableColumn>`, sheet) })),
      xml: anchorXml(`<table xmlns="${NS}" id="1" name="Sales" displayName="Sales" ref="A1:C6" totalsRowCount="1"><autoFilter ref="A1:C5"><filterColumn colId="1"><filters><filter val="21"/></filters></filterColumn><filterColumn colId="2"><filters><filter val="22"/></filters></filterColumn></autoFilter><tableColumns count="0"/></table>`, sheet),
    } satisfies SheetTable)
    sheet.filter.set('value', { range: sheet.rangeIds({ top: 0, left: 0, bottom: 4, right: 2 }), columns: [{ col: 1, values: ['21'] }, { col: 2, values: ['22'] }] } satisfies AutoFilter)
    sheet.merges.set('merge', { range: sheet.rangeIds({ top: 7, left: 0, bottom: 8, right: 2 }) })
    const ranges = [sheet.rangeIds({ top: 1, left: 0, bottom: 4, right: 2 })]
    sheet.cf.set('cf', { ranges, rules: [{ type: 'expression', priority: 1, formulas: [toIdForm('A2>0', sheet)] }] })
    sheet.dv.set('dv', { ranges, type: 'whole', formula1: toIdForm('$A$2', sheet) })
    sheet.links.set(sheet.keyAt(1, 0), { location: 'Data!C2', range: ranges[0] })
    sheet.notes.set(sheet.keyAt(2, 1), { author: 'Tester', text: 'note' })
    sheet.setRowProp([2], 'size', 24)
    sheet.setRowProp([3], 'hidden', true)
    sheet.setRowProp([3], 'level', 1)
    sheet.setViewProp('frozenRows', 2)
    sheet.setViewProp('frozenCols', 1)
    sheet.setViewProp('selection', 'B2:C4')
    sheet.setViewProp('topLeft', { row: sheet.rows.idAt(2), col: sheet.cols.idAt(1) })
    sheet.drawings.set('image', { kind: 'image', anchor: 'twoCell', from: { row: sheet.rows.idAt(1), col: sheet.cols.idAt(0), rowOff: 0, colOff: 0 }, to: { row: sheet.rows.idAt(4), col: sheet.cols.idAt(2), rowOff: 0, colOff: 0 }, xml: '', links: { rId1: 'xl/charts/chart1.xml' }, chart: 'xl/charts/chart1.xml', z: 1 } satisfies DrawingObject)
    sheet.raw.set('xml', anchorXml(`<worksheet xmlns="${NS}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><sheetData/><extLst><ext uri="spark"><x14:sparklineGroups><x14:sparklineGroup><x14:sparklines><x14:sparkline><xm:f>Data!A2:C2</xm:f><xm:sqref>E2</xm:sqref></x14:sparkline></x14:sparklines></x14:sparklineGroup></x14:sparklineGroups></ext></extLst></worksheet>`, sheet))
    keepReferencePart(sheet, 'xl/charts/chart1.xml', '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:ser><c:val><c:numRef><c:f>Data!$C$2:$C$5</c:f></c:numRef></c:val></c:ser></c:chart></c:chartSpace>')
    sheet.raw.set('drawingRels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>')
    sheet.raw.set('rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdThread" Type="http://schemas.microsoft.com/office/2017/10/relationships/threadedComment" Target="../threadedComments/threadedComment1.xml"/></Relationships>')
    keepReferencePart(sheet, 'xl/threadedComments/threadedComment1.xml', '<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><threadedComment ref="B3" id="test"><text>hello</text></threadedComment></ThreadedComments>')
    model.names.set('print', { name: '_xlnm.Print_Area', scope: sheet.id, formula: toIdForm('Data!$A$1:$C$6', sheet) })
    other.setCell(0, 0, { f: toIdForm('SUM(Sales[C])', other) })
    other.setCell(1, 0, { f: toIdForm('Data!C2', other) })
  })
  return { doc, model, sheet, other, assets: new MemoryLiveAssetStore() }
}

function part(bytes: Uint8Array, path: string) { return strFromU8(unzipSync(bytes)[path]!) }
function table(sheet: ReturnType<typeof richWorkbook>['sheet']) { return sheet.tables.get('sales') as SheetTable }

describe('structural metadata identities', () => {
  it('returns #REF! for Sales[C] after deleting the final column', async () => {
    const { doc, sheet, other, model, assets } = richWorkbook()
    const calc = new SheetCalc(model)
    expect(calc.get(other, 0, 0)).toBe(108)
    deleteAxis(sheet, 'col', 2, 1)
    expect(table(sheet).columns.map((column) => column.name)).toEqual(['A', 'B'])
    expect(calc.get(other, 0, 0)).toEqual({ e: '#REF!' })
    expect(toA1Form(other.cell(0, 0)!.f!, other)).toBe('SUM(#REF!)')
    expect(toA1Form(other.cell(1, 0)!.f!, other)).toBe('Data!#REF!')
    const bytes = await writeXlsx(doc, assets)
    expect(part(bytes, 'xl/tables/table1.xml')).not.toContain('name="C"')
    expect(part(bytes, 'xl/charts/chart1.xml')).toContain('Data!#REF!')
    calc.destroy()
  })

  it('keeps surviving interior-column XML, filter identities and inserted column definitions', async () => {
    const { doc, sheet, assets } = richWorkbook()
    deleteAxis(sheet, 'col', 1, 1)
    expect(table(sheet).columns.map((column) => column.name)).toEqual(['A', 'C'])
    let xml = part(await writeXlsx(doc, assets), 'xl/tables/table1.xml')
    expect(xml).toContain('name="C" totalsRowFunction="max"')
    expect(xml).toContain('<calculatedColumnFormula>B2*3</calculatedColumnFormula>')
    expect(xml).toContain('<totalsRowFormula>SUM(B2:B5)</totalsRowFormula>')
    expect(xml).not.toContain('totalsRowFunction="average"')
    expect(xml).toContain('filterColumn colId="1"')
    expect(xml).not.toContain('filterColumn colId="2"')
    expect((sheet.filter.get('value') as AutoFilter).columns).toEqual([{ col: 1, values: ['22'] }])
    insertAxis(sheet, 'col', 1, 2)
    expect(table(sheet).columns.map((column) => column.name)).toEqual(['A', 'Column1', 'Column2', 'C'])
    expect(sheet.cell(0, 1)?.v).toBe('Column1')
    xml = part(await writeXlsx(doc, assets), 'xl/tables/table1.xml')
    expect(xml).toContain('filterColumn colId="3"')
    expect(xml).toContain('<calculatedColumnFormula>D2*3</calculatedColumnFormula>')
  })

  it('reorders table columns by identity and rejects a move that would split a table', () => {
    const { sheet } = richWorkbook()
    moveAxis(sheet, 'col', 0, 1, 2)
    expect(table(sheet).columns.map((column) => column.name)).toEqual(['B', 'C', 'A'])
    expect(sheet.resolveRange(table(sheet).range)).toMatchObject({ left: 0, right: 2 })
    const ids = sheet.cols.resolve().ids
    expect(() => moveAxis(sheet, 'col', 1, 1, 8)).toThrow('Cannot move part of a table')
    expect(sheet.cols.resolve().ids).toEqual(ids)
  })

  it('deletes totals identity, rebases panes, notes, links, selections and extension references', async () => {
    const { doc, sheet, model, assets } = richWorkbook()
    deleteAxis(sheet, 'row', 5, 1)
    expect(table(sheet).totalsRow).toBe(false)
    insertAxis(sheet, 'row', 0, 2)
    expect(sheet.viewProp('frozenRows')).toBe(4)
    expect(sheet.viewProp('selection')).toBe('B4:C6')
    model.renameSheet(sheet.id, 'Renamed Data')
    const bytes = await writeXlsx(doc, assets)
    expect(part(bytes, 'xl/charts/chart1.xml')).toContain("'Renamed Data'!$C$4:$C$7")
    expect(part(bytes, 'xl/threadedComments/threadedComment1.xml')).toContain('ref="B5"')
    expect(part(bytes, 'xl/worksheets/sheet1.xml')).toContain("'Renamed Data'!A4:C4")
    deleteAxis(sheet, 'row', 4, 1)
    expect(part(await writeXlsx(doc, assets), 'xl/threadedComments/threadedComment1.xml')).not.toContain('<threadedComment ')
  })

  it('tracks 3D sheet renames, deletion of span endpoints and tab reordering', () => {
    const { model, sheet, other } = richWorkbook()
    const last = model.addSheet('Last')
    const formula = toIdForm('SUM(Data:Last!A1)', other)
    model.renameSheet(sheet.id, 'First Tab')
    expect(toA1Form(formula, other)).toBe("SUM('First Tab:Last'!A1)")
    model.moveSheet(other.id, 2)
    expect(toA1Form(formula, other)).toBe("SUM('First Tab:Last'!A1)")
    model.deleteSheet(sheet.id)
    expect(toA1Form(formula, other)).toBe('SUM(Last!A1)')
    model.deleteSheet(last.id)
    expect(toA1Form(formula, other)).toBe('SUM(#REF!)')
  })

  it('preserves moved range membership, rule origins and unions when endpoints reorder', () => {
    const { model, other } = richWorkbook()
    const sheet = model.addSheet('Move')
    for (let row = 0; row < 5; row++) sheet.setCell(row, 0, { v: row + 1 })
    const range = sheet.rangeIds({ top: 0, bottom: 2, left: 0, right: 0 })
    sheet.cf.set('condition', { ranges: [range], rules: [{ type: 'expression', priority: 1, formulas: [toIdForm('A1>0', sheet)] }] })
    other.setCell(8, 0, { f: toIdForm('SUM(Move!A1:A3)', other) })
    moveAxis(sheet, 'row', 0, 1, 2)
    expect(toA1Form(other.cell(8, 0)!.f!, other)).toBe('SUM(Move!A1:A3)')
    const format = sheet.cf.get('condition') as import('./schema.js').ConditionalFormat
    expect(sheet.resolveRange(format.ranges[0]!)).toEqual({ top: 0, bottom: 2, left: 0, right: 0 })
    expect(toA1Form(format.rules[0]!.formulas![0]!, sheet)).toBe('A1>0')
    moveAxis(sheet, 'row', 1, 1, 5)
    expect(toA1Form(other.cell(8, 0)!.f!, other)).toBe('SUM((Move!A1:A2,Move!A6:A6))')
    const calc = new SheetCalc(model)
    expect(calc.get(other, 8, 0)).toBe(6)
    calc.destroy()
  })

  it('cuts overlapping cells with their notes and redirects absolute references in other sheets', () => {
    const { model, other } = richWorkbook()
    const source = model.addSheet('Cut')
    source.setCell(0, 0, { v: 10 })
    source.setCell(1, 0, { f: toIdForm('A1+$C$1', source) })
    source.setCell(0, 2, { v: 3 })
    source.notes.set(source.keyAt(0, 0), { author: 'Tester', text: 'moves' })
    source.links.set(source.keyAt(0, 0), { location: 'Cut!A1' })
    other.setCell(4, 0, { f: toIdForm('Cut!$A$1', other) })
    moveCells(source, source, { top: 0, bottom: 1, left: 0, right: 0 }, { row: 1, col: 0 })
    expect(source.cell(0, 0)).toBeUndefined()
    expect(source.cell(1, 0)?.v).toBe(10)
    expect(toA1Form(source.cell(2, 0)!.f!, source)).toBe('A2+$C$1')
    expect(toA1Form(other.cell(4, 0)!.f!, other)).toBe('Cut!$A$2')
    expect(source.notes.get(source.keyAt(1, 0))).toMatchObject({ text: 'moves' })
    expect(source.links.get(source.keyAt(1, 0))).toMatchObject({ location: 'Cut!A2' })
    moveCells(source, other, { top: 1, bottom: 2, left: 0, right: 0 }, { row: 6, col: 1 })
    expect(toA1Form(other.cell(7, 1)!.f!, other)).toBe('B7+Cut!$C$1')
    expect(toA1Form(other.cell(4, 0)!.f!, other)).toBe('Results!$B$7')
    expect(other.notes.get(other.keyAt(6, 1))).toMatchObject({ text: 'moves' })
  })

  it('cuts table metadata, chart relationships, sparklines and threaded comments between sheets', async () => {
    const { doc, sheet, other, assets } = richWorkbook()
    moveCells(sheet, other, { top: 0, left: 0, bottom: 5, right: 4 }, { row: 9, col: 6 })
    expect(sheet.tables.size).toBe(0)
    expect(other.tables.size).toBe(1)
    const bytes = await writeXlsx(doc, assets)
    const xml = part(bytes, 'xl/tables/table1.xml')
    expect(xml).toContain('ref="G10:I15"')
    expect(xml).toContain('<calculatedColumnFormula>I11*3</calculatedColumnFormula>')
    expect(part(bytes, 'xl/charts/chart1.xml')).toContain('Results!$I$11:$I$14')
    const worksheet = part(bytes, 'xl/worksheets/sheet2.xml')
    expect(worksheet).toContain('Results!G11:I11')
    expect(worksheet).toContain('K11</xm:sqref>')
    const zip = unzipSync(bytes)
    const threads = Object.keys(zip).filter((path) => path.startsWith('xl/threadedComments/')).map((path) => strFromU8(zip[path]!)).join('')
    expect(threads).toContain('ref="H12"')
    expect(threads).not.toContain('ref="B3"')
  })

  it('splits validation and conditional format coverage during a partial cut', () => {
    const { model } = richWorkbook()
    const sheet = model.addSheet('Rules')
    sheet.dv.set('rule', { ranges: [sheet.rangeIds({ top: 0, bottom: 4, left: 0, right: 0 })], type: 'custom', formula1: toIdForm('A1>0', sheet) })
    moveCells(sheet, sheet, { top: 1, bottom: 2, left: 0, right: 0 }, { row: 1, col: 2 })
    const rules = [...sheet.dv.values()] as import('./schema.js').DataValidation[]
    const ranges = rules.flatMap((rule) => rule.ranges.map((r) => sheet.resolveRange(r)))
    expect(ranges).toContainEqual({ top: 0, bottom: 0, left: 0, right: 0 })
    expect(ranges).toContainEqual({ top: 3, bottom: 4, left: 0, right: 0 })
    expect(ranges).toContainEqual({ top: 1, bottom: 2, left: 2, right: 2 })
    const moved = rules.find((rule) => sheet.resolveRange(rule.ranges[0]!)?.left === 2)!
    expect(toA1Form(moved.formula1!, sheet)).toBe('C2>0')
  })

  it('sorts notes and hyperlinks with their records', () => {
    const { model } = richWorkbook()
    const sheet = model.addSheet('Sort')
    sheet.setCell(0, 0, { v: 2 })
    sheet.setCell(1, 0, { v: 1 })
    sheet.notes.set(sheet.keyAt(0, 0), { author: 'Tester', text: 'two' })
    sheet.links.set(sheet.keyAt(0, 0), { target: 'https://example.com/2' })
    sortRange(sheet, { top: 0, left: 0, bottom: 1, right: 0 }, [{ col: 0 }], (row, col) => sheet.cell(row, col)?.v ?? null)
    expect(sheet.notes.has(sheet.keyAt(0, 0))).toBe(false)
    expect(sheet.notes.get(sheet.keyAt(1, 0))).toMatchObject({ text: 'two' })
    expect(sheet.links.get(sheet.keyAt(1, 0))).toMatchObject({ target: 'https://example.com/2' })
  })

  it('keeps structural invariants across seeded edits and exports loadable workbooks', { timeout: 120_000 }, async () => {
    const work = mkdtempSync(join(tmpdir(), 'pulpo-structural-properties-'))
    try {
      let seed = 947
      const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max }
      const { doc, sheet, model, other, assets } = richWorkbook()
      const scratch = model.addSheet('Scratch')
      scratch.setCell(0, 0, { v: 1 })
      scratch.notes.set(scratch.keyAt(0, 0), { author: 'Tester', text: 'cut' })
      const paths: string[] = []
      const expected: unknown[] = []
      for (let step = 0; step < 40; step++) {
        const kind = random(2) ? 'row' : 'col'
        const operation = random(10)
        const current = table(sheet)
        const range = current && sheet.resolveRange(current.range)
        if (operation <= 1) insertAxis(sheet, kind, random(5), 1)
        else if (operation === 2 && range && (kind === 'row' ? range.bottom - range.top : range.right - range.left) > 1) deleteAxis(sheet, kind, kind === 'row' ? range.top + 1 : range.left + random(range.right - range.left + 1), 1)
        else if (operation === 3 && range && kind === 'col') moveAxis(sheet, 'col', range.left, 1, range.right)
        else if (operation === 4) model.renameSheet(sheet.id, `Data ${step}`)
        else if (operation === 5) model.moveSheet(other.id, random(2))
        else if (operation === 6) {
          const source = { row: random(4), col: random(4) }
          moveCells(scratch, scratch, { top: source.row, bottom: source.row, left: source.col, right: source.col }, { row: random(4), col: random(4) })
        } else if (operation === 7) {
          const transient = model.addSheet(`Transient ${step}`)
          scratch.setCell(9, 9, { f: toIdForm(`'${transient.name}'!A1`, scratch) })
          model.deleteSheet(transient.id)
          expect(toA1Form(scratch.cell(9, 9)!.f!, scratch)).toBe('#REF!')
        } else if (operation === 8 && range && range.bottom - range.top > 3) moveAxis(sheet, 'row', range.top + 1, 1, range.bottom - 1)
        else if (range && range.bottom - range.top > 2) sortRange(sheet, { ...range, top: range.top + 1, bottom: range.bottom - (current.totalsRow ? 1 : 0) }, [{ col: 0 }], (row, col) => sheet.cell(row, col)?.v ?? null)
        for (const owner of model.sheets()) {
          for (const raw of owner.tables.values()) {
            const entry = raw as SheetTable
            const rect = owner.resolveRange(entry.range)!
            expect(rect).toBeDefined()
            expect(entry.columns.length).toBe(rect.right - rect.left + 1)
            expect(new Set(entry.columns.map((column) => column.name.toLowerCase())).size).toBe(entry.columns.length)
          }
          const filter = owner.filter.get('value') as AutoFilter | undefined
          const rect = filter && owner.resolveRange(filter.range)
          if (rect) expect(filter!.columns.every((column) => column.col >= 0 && column.col <= rect.right - rect.left)).toBe(true)
          for (const key of [...owner.notes.keys(), ...owner.links.keys(), ...owner.cells.keys()]) expect(owner.position(key)).toBeDefined()
          for (const raw of owner.drawings.values()) {
            const drawing = raw as DrawingObject
            for (const point of [drawing.from, drawing.to]) if (point) { expect(owner.rows.indexOf(point.row)).toBeGreaterThanOrEqual(0); expect(owner.cols.indexOf(point.col)).toBeGreaterThanOrEqual(0) }
          }
          expect(resolveXml(owner.raw.get('xml') as string ?? '', owner)).not.toContain('⟦')
        }
        const bytes = await writeXlsx(doc, assets)
        const path = join(work, `${step}.xlsx`)
        writeFileSync(path, bytes)
        paths.push(path)
        expected.push(Object.fromEntries(model.sheets().map((owner) => [owner.name, [...owner.tables.values()].map((raw) => { const t = raw as SheetTable; return [t.name, t.columns.map((column) => column.name)] })])))
        const imported = new Y.Doc()
        await readXlsx(imported, bytes, assets)
        expect(new WorkbookModel(imported).sheets().length).toBe(model.sheets().length)
      }
      if (fidelityAvailable()) {
        const check = spawnSync(fidelityPython(), ['-I', '-c', 'import json,sys,openpyxl; print(json.dumps([{s.title:[[t.name,[c.name for c in t.tableColumns]] for t in s.tables.values()] for s in openpyxl.load_workbook(p).worksheets} for p in sys.argv[1:]]))', ...paths], { encoding: 'utf8' })
        expect(check.status, check.stderr).toBe(0)
        expect(JSON.parse(check.stdout)).toEqual(expected)
      }
      if (libreOfficeAvailable() && process.env.PULPO_OFFICE_FIDELITY === '1') {
        const result = libreOfficeConvert(paths[paths.length - 1]!, 'xlsx', join(work, 'lo'))
        expect(result.ok, result.error).toBe(true)
      }
    } finally { rmSync(work, { recursive: true, force: true }) }
  })
})
