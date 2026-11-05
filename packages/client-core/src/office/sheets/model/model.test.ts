import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { scanReferences, shiftFormula } from './references.js'
import { toA1Form, toIdForm } from './formula-ids.js'
import { deleteAxis, insertAxis, moveAxis } from './structure.js'
import { WorkbookModel } from './workbook.js'

function newWorkbook(): { doc: Y.Doc; model: WorkbookModel } {
  const doc = new Y.Doc()
  const model = WorkbookModel.initialize(doc)
  model.addSheet('Sheet1')
  return { doc, model }
}

/** Two replicas of the same workbook that exchange updates on `sync()`. */
function replicas(): { a: WorkbookModel; b: WorkbookModel; sync: () => void } {
  const { doc } = newWorkbook()
  const docA = new Y.Doc()
  const docB = new Y.Doc()
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(doc))
  const sync = () => {
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA)))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)))
  }
  return { a: new WorkbookModel(docA), b: new WorkbookModel(docB), sync }
}

function grid(model: WorkbookModel, rows = 6, cols = 3): (string | number | null)[][] {
  const sheet = model.sheets()[0]!
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const data = sheet.cell(row, col)
      if (!data) return null
      return data.f !== undefined ? `=${toA1Form(data.f, sheet)}` : (data.v as string | number)
    }),
  )
}

describe('axis', () => {
  it('addresses rows past the stored end with virtual ids that survive materialization', () => {
    const { model } = newWorkbook()
    const sheet = model.sheets()[0]!
    expect(sheet.rows.length).toBe(1024)
    const virtual = sheet.rows.idAt(5000)
    expect(sheet.rows.indexOf(virtual)).toBe(5000)
    sheet.setCell(10, 0, { v: 1 })
    expect(sheet.rows.length).toBe(1024)
    expect(sheet.rows.indexOf(virtual)).toBe(5000)
    sheet.setCell(4500, 0, { v: 1 })
    expect(sheet.rows.length).toBe(5120)
    expect(sheet.rows.idAt(5000)).toBe(virtual)
    insertAxis(sheet, 'row', 0, 2)
    expect(sheet.rows.indexOf(virtual)).toBe(5002)
    deleteAxis(sheet, 'row', 0, 5)
    expect(sheet.rows.indexOf(virtual)).toBe(4997)
  })

  it('merges concurrent materialization without duplicating rows', () => {
    const { a, b, sync } = replicas()
    a.sheets()[0]!.setCell(20, 0, { v: 'a' })
    b.sheets()[0]!.setCell(15, 1, { v: 'b' })
    sync()
    for (const model of [a, b]) {
      const sheet = model.sheets()[0]!
      expect(sheet.cell(20, 0)?.v).toBe('a')
      expect(sheet.cell(15, 1)?.v).toBe('b')
      expect(sheet.rows.length).toBe(1024)
    }
  })

  it('keeps a cell typed past the stored rows concurrently with a row inserted above it', () => {
    const { a, b, sync } = replicas()
    insertAxis(a.sheets()[0]!, 'row', 29, 1)
    b.sheets()[0]!.setCell(30, 0, { v: 'typed' })
    sync()
    for (const model of [a, b]) expect(model.sheets()[0]!.cell(31, 0)?.v).toBe('typed')
  })

  it('keeps a cell typed concurrently with a row insert above it', () => {
    const { a, b, sync } = replicas()
    a.sheets()[0]!.setCell(4, 0, { v: 'old' })
    sync()
    insertAxis(a.sheets()[0]!, 'row', 0, 1)
    b.sheets()[0]!.setCell(4, 1, { v: 'typed' })
    sync()
    for (const model of [a, b]) {
      expect(model.sheets()[0]!.cell(5, 0)?.v).toBe('old')
      expect(model.sheets()[0]!.cell(5, 1)?.v).toBe('typed')
    }
  })

  it('drops a cell typed concurrently into a deleted row instead of resurrecting the row', () => {
    const { a, b, sync } = replicas()
    a.sheets()[0]!.setCell(2, 0, { v: 'keep' })
    a.sheets()[0]!.setCell(3, 0, { v: 'below' })
    sync()
    deleteAxis(a.sheets()[0]!, 'row', 2, 1)
    b.sheets()[0]!.setCell(2, 1, { v: 'lost' })
    sync()
    for (const model of [a, b]) {
      expect(grid(model, 4, 2)).toEqual([[null, null], [null, null], ['below', null], [null, null]])
    }
  })
})

describe('references', () => {
  it('finds references and leaves names, functions, strings, and structured references alone', () => {
    const refs = scanReferences(`SUM(A1:B2,$C$3)+'My ''Sheet'''!D4+Sheet2!E:E+2:3+LOG10(5)+"A1"+Table1[Col1]+TAX_RATE+_xlfn.XLOOKUP(Z9,A:A,B:B)+[1]Ext!A1`)
    const texts = refs.map((ref) => ref.kind === 'ref' ? `${ref.sheet?.first ?? ''}|${ref.external ? 'x' : ''}` : `name:${ref.name}`)
    expect(texts).toEqual(['|', '|', "My 'Sheet'|", 'Sheet2|', '|', '|', '|', '|', 'Ext|x'])
  })

  it('shifts relative references when copying', () => {
    expect(shiftFormula('A1+$A$1+A$1+$A1+SUM(B2:C3)', 1, 1)).toBe('B2+$A$1+B$1+$A2+SUM(C3:D4)')
    expect(shiftFormula('A1', -1, 0)).toBe('#REF!')
    expect(shiftFormula('Sheet2!A:A+1:1', 2, 2)).toBe('Sheet2!C:C+3:3')
    expect(shiftFormula('"A1"&A1', 1, 0)).toBe('"A1"&A2')
  })
})

describe('id-form formulas', () => {
  it('round-trips references through id form', () => {
    const { model } = newWorkbook()
    model.addSheet('Data Sheet')
    const sheet = model.sheets()[0]!
    for (const formula of ['SUM(A1:B2)*$C$3', "'Data Sheet'!A1+Data!B2", 'A:A+3:5', 'COUNTIF(Sheet1!$B$2:$B$1000,">0")', '"⟦not a token⟧"&A1']) {
      expect(toA1Form(toIdForm(formula, sheet), sheet)).toBe(formula)
    }
  })

  it('follows rows and columns through structural edits and sheet renames', () => {
    const { model } = newWorkbook()
    const data = model.addSheet('Data')
    const sheet = model.sheets()[0]!
    const stored = toIdForm('SUM(A2:A10)+Data!B5', sheet)
    insertAxis(sheet, 'row', 0, 3)
    insertAxis(data, 'col', 0, 1)
    model.renameSheet(data.id, 'Numbers 2024')
    expect(toA1Form(stored, sheet)).toBe("SUM(A5:A13)+'Numbers 2024'!C5")
  })

  it('shrinks ranges and breaks single references when rows are deleted', () => {
    const { model } = newWorkbook()
    const sheet = model.sheets()[0]!
    sheet.setCell(0, 2, { f: toIdForm('SUM(A2:A10)+A5+SUM(A5:A6)', sheet) })
    deleteAxis(sheet, 'row', 4, 2)
    expect(`=${toA1Form(sheet.cell(0, 2)!.f!, sheet)}`).toBe('=SUM(A2:A8)+#REF!+SUM(#REF!)')
    deleteAxis(sheet, 'row', 7, 1)
    expect(`=${toA1Form(sheet.cell(0, 2)!.f!, sheet)}`).toBe('=SUM(A2:A7)+#REF!+SUM(#REF!)')
    deleteAxis(sheet, 'row', 1, 1)
    expect(`=${toA1Form(sheet.cell(0, 2)!.f!, sheet)}`).toBe('=SUM(A2:A6)+#REF!+SUM(#REF!)')
  })

  it('resolves a range edge deleted concurrently by shrinking', () => {
    const { a, b, sync } = replicas()
    const sheetA = a.sheets()[0]!
    sheetA.setCell(20, 0, { v: 1 })
    sync()
    deleteAxis(sheetA, 'row', 9, 1)
    const sheetB = b.sheets()[0]!
    sheetB.setCell(0, 1, { f: toIdForm('SUM(A1:A10)', sheetB) })
    sync()
    for (const model of [a, b]) expect(toA1Form(model.sheets()[0]!.cell(0, 1)!.f!, model.sheets()[0]!)).toBe('SUM(A1:A9)')
  })

  it('moves formulas with moved rows', () => {
    const { model } = newWorkbook()
    const sheet = model.sheets()[0]!
    sheet.setCell(0, 0, { v: 'a' })
    sheet.setCell(1, 0, { v: 'b' })
    sheet.setCell(2, 0, { v: 'c' })
    sheet.setCell(0, 1, { f: toIdForm('A3', sheet) })
    moveAxis(sheet, 'row', 2, 1, 0)
    expect(grid(model, 3, 2)).toEqual([['c', null], ['a', '=A1'], ['b', null]])
  })
})

describe('sheets', () => {
  it('adds, renames, moves, hides, and deletes sheets with Excel naming rules', () => {
    const { model } = newWorkbook()
    const second = model.addSheet(model.nextSheetName())
    expect(second.name).toBe('Sheet2')
    expect(() => model.renameSheet(second.id, 'bad/name')).toThrow()
    expect(() => model.renameSheet(second.id, 'SHEET1')).toThrow()
    model.renameSheet(second.id, 'Totals')
    model.moveSheet(second.id, 0)
    expect(model.sheets().map((sheet) => sheet.name)).toEqual(['Totals', 'Sheet1'])
    model.setSheetState(second.id, 'hidden')
    expect(() => model.setSheetState(model.sheets()[1]!.id, 'hidden')).toThrow()
    model.deleteSheet(second.id)
    expect(model.sheets().map((sheet) => sheet.name)).toEqual(['Sheet1'])
    expect(model.uniqueSheetName('Sheet1')).toBe('Sheet1 (2)')
  })

  it('keeps style overrides from two people formatting the same range', () => {
    const { a, b, sync } = replicas()
    const range = { top: 0, left: 0, bottom: 2, right: 2 }
    a.sheets()[0]!.setStyle(range, { bold: true })
    b.sheets()[0]!.setStyle(range, { fill: { rgb: 'FFFF00' } })
    sync()
    for (const model of [a, b]) {
      const sheet = model.sheets()[0]!
      expect(sheet.cellOverrides(sheet.keyAt(1, 1))).toEqual({ bold: true, fill: { rgb: 'FFFF00' } })
    }
  })
})

describe('axis bounds', () => {
  it('never stores past the largest sheet, whatever position it is asked for', () => {
    const doc = new Y.Doc()
    const sheet = WorkbookModel.initialize(doc).addSheet('Sheet1')
    doc.transact(() => {
      sheet.rows.ensure(Infinity)
      sheet.rows.ensure(Number.NaN)
      sheet.cols.ensure(-5)
    })
    expect(sheet.rows.length).toBe(1024)
    doc.transact(() => sheet.rows.ensure(5_000_000))
    expect(sheet.rows.length).toBe(1_048_576)
  }, 30_000)
})
