import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryAssetStore } from '../../memory-assets.js'
import { toIdForm } from '../model/formula-ids.js'
import { deleteAxis, insertAxis } from '../model/structure.js'
import { WorkbookModel } from '../model/workbook.js'
import { SheetCodec } from '../codec/codec.js'
import { matchSequences } from './sequence.js'
import { diffSheetFiles, diffWorkbooks } from './workbook-diff.js'

function workbook(): { doc: Y.Doc; model: WorkbookModel } {
  const doc = new Y.Doc()
  const model = WorkbookModel.initialize(doc)
  const sheet = model.addSheet('Data')
  ;['Name', 'Qty'].forEach((value, col) => sheet.setCell(0, col, { v: value }))
  for (let row = 1; row <= 5; row++) {
    sheet.setCell(row, 0, { v: `Item ${row}` })
    sheet.setCell(row, 1, { v: row * 10 })
  }
  sheet.setCell(6, 1, { f: toIdForm('SUM(B2:B6)', sheet) })
  return { doc, model }
}

function copy(doc: Y.Doc): { doc: Y.Doc; model: WorkbookModel } {
  const next = new Y.Doc()
  Y.applyUpdate(next, Y.encodeStateAsUpdate(doc))
  return { doc: next, model: new WorkbookModel(next) }
}

describe('matchSequences', () => {
  it('matches common lines and reports gaps', () => {
    expect(matchSequences(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e'])).toEqual([[0, 0], [2, 2], [3, 3]])
    expect(matchSequences([], ['a'])).toEqual([])
    expect(matchSequences(['a', 'b'], ['b', 'a'])!.length).toBe(1)
    expect(matchSequences(Array.from({ length: 50 }, (_, i) => `a${i}`), Array.from({ length: 50 }, (_, i) => `b${i}`), 10)).toBeUndefined()
  })
})

describe('diffWorkbooks', () => {
  it('reports nothing for identical workbooks', () => {
    const before = workbook()
    const diff = diffWorkbooks(before.doc, copy(before.doc).doc)
    expect(diff.totals).toEqual({ cellsChanged: 0, sheetsChanged: 0 })
    expect(diff.sheets[0]!.status).toBe('unchanged')
  })

  it('reports values, formulas, and formats by address', () => {
    const before = workbook()
    const after = copy(before.doc)
    const sheet = after.model.sheets()[0]!
    sheet.setCell(2, 1, { v: 25 })
    sheet.setCell(6, 1, { f: toIdForm('AVERAGE(B2:B6)', sheet) })
    sheet.setCell(7, 0, { v: 'Note' })
    sheet.setCell(5, 0, undefined)
    sheet.setStyle({ top: 0, left: 0, bottom: 0, right: 1 }, { bold: true })
    const diff = diffWorkbooks(before.doc, after.doc)
    const cells = diff.sheets[0]!.cells
    expect(cells.map((cell) => [cell.address, cell.kind, cell.before, cell.after])).toEqual([
      ['A1', 'changed', 'Name', 'Name'],
      ['B1', 'changed', 'Qty', 'Qty'],
      ['B3', 'changed', '20', '25'],
      ['A6', 'removed', 'Item 5', undefined],
      ['B7', 'changed', '=SUM(B2:B6)', '=AVERAGE(B2:B6)'],
      ['A8', 'added', undefined, 'Note'],
    ])
    expect(cells[0]!.format).toEqual([{ property: 'bold', before: 'off', after: 'on' }])
  })

  it('reports inserted and deleted rows instead of every moved cell', () => {
    const before = workbook()
    const after = copy(before.doc)
    const sheet = after.model.sheets()[0]!
    insertAxis(sheet, 'row', 2, 2)
    sheet.setCell(2, 0, { v: 'New A' })
    sheet.setCell(3, 0, { v: 'New B' })
    deleteAxis(sheet, 'row', 6, 1)
    const diff = diffWorkbooks(before.doc, after.doc)
    const target = diff.sheets[0]!
    expect(target.structure).toEqual([
      { kind: 'rowsInserted', from: '3', to: '4', count: 2 },
      { kind: 'rowsDeleted', from: '5', to: '5', count: 1 },
    ])
    // The total's range grew with the insert and shrank with the delete.
    expect(target.cells.map((cell) => [cell.address, cell.before, cell.after])).toEqual([
      ['A3', undefined, 'New A'],
      ['A4', undefined, 'New B'],
      ['B8', '=SUM(B2:B6)', '=SUM(B2:B7)'],
    ])
  })

  it('reports added, removed, and renamed sheets and names', () => {
    const before = workbook()
    before.model.addSheet('Old')
    const after = copy(before.doc)
    after.model.renameSheet(after.model.sheets()[0]!.id, 'Inventory')
    after.model.deleteSheet(after.model.sheets()[1]!.id)
    after.model.addSheet('New').setCell(0, 0, { v: 1 })
    after.model.names.set('n1', { name: 'Total', formula: toIdForm('Inventory!$B$7', undefined, after.model) })
    const diff = diffWorkbooks(before.doc, after.doc)
    expect(diff.sheets.map((sheet) => [sheet.name, sheet.status, sheet.previousName])).toEqual([
      ['Inventory', 'changed', 'Data'],
      ['New', 'added', undefined],
      ['Old', 'removed', undefined],
    ])
    expect(diff.names).toEqual([{ name: 'Total', kind: 'added', after: 'Inventory!$B$7' }])
  })

  it('compares files and caps very large changes', async () => {
    const codec = new SheetCodec()
    const assets = new MemoryAssetStore()
    const before = workbook()
    const after = copy(before.doc)
    for (let row = 10; row < 700; row++) after.model.sheets()[0]!.setCell(row, 0, { v: row })
    const diff = await diffSheetFiles(
      await codec.exportFile(before.doc, { name: 'a.xlsx', assets }),
      await codec.exportFile(after.doc, { name: 'a.xlsx', assets }),
      { name: 'a.xlsx', assets },
      { maxCellsPerSheet: 100 },
    )
    expect(diff.sheets[0]!.cells).toHaveLength(100)
    expect(diff.totals.cellsChanged).toBe(690)
    expect(diff.truncated).toBe(true)
  })
})
