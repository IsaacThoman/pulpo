import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { parseRangeList, parseRangeName } from '../address.js'
import { SheetCalc } from '../calc.js'
import { toIdForm } from '../model/formula-ids.js'
import { WorkbookModel } from '../model/workbook.js'
import { setValidation, validationAt } from './commands.js'
import { evaluateRuleFormula, ruleAnchor, ruleFormula } from './rule-formula.js'

function fixture() {
  const book = WorkbookModel.initialize(new Y.Doc())
  const sheet = book.addSheet('Sheet1')
  book.addSheet('Other Sheet')
  return { book, sheet }
}

it.each([
  ['A1:A10 C20:D30', 'C25', '$A1>B1', '$A25>D25'],
  // First sqref rectangle, not the bounding box or the rectangle containing the target.
  ['C20:D30 A1:A10', 'A5', '$A20>D$20+$F$1', '$A5>B$20+$F$1'],
  ['B2:C10 F20:G30', 'G23', "'Other Sheet'!A1+$B2+C$3+$D$4", "'Other Sheet'!F22+$B23+H$3+$D$4"],
  ['B2:C10 A1', 'A1', 'A1+$A1+A$1+$A$1', '#REF!+#REF!+#REF!+$A$1'],
  ['A1:B2', 'B2', 'XFD1+A1048576', '#REF!+#REF!'],
  ['B2:C10', 'C5', 'SUM(A:A,1:1,$A:$B,$1:$2)', 'SUM(B:B,4:4,$A:$B,$1:$2)'],
])('translates %s at %s', (sqref, target, formula, expected) => {
  const { sheet } = fixture()
  const anchor = ruleAnchor(sheet, parseRangeList(sqref).map((range) => sheet.rangeIds(range)))!
  const cell = parseRangeName(target)!
  expect(ruleFormula(sheet, toIdForm(formula, sheet), anchor, cell.top, cell.left)).toBe(expected)
})

describe('rule formula evaluation', () => {
  it('evaluates mixed references and cross-sheet references at the target', () => {
    const { book, sheet } = fixture()
    book.sheetByName('Other Sheet')!.setCell(4, 1, { v: 42 })
    const calc = new SheetCalc(book)
    try {
      expect(evaluateRuleFormula(sheet, calc, toIdForm("'Other Sheet'!B1", sheet), parseRangeName('A1:A10')!, 4, 0)).toBe(42)
      expect(evaluateRuleFormula(sheet, calc, toIdForm('A1', sheet), parseRangeName('B2:B3')!, 0, 0)).toEqual({ e: '#REF!' })
    } finally { calc.destroy() }
  })

  it('uses the rebased first survivor after a range split removes the anchor', () => {
    const { book, sheet } = fixture()
    setValidation(sheet, parseRangeList('A1:A10 C20:C30'), { type: 'whole', formula1: 'B1+$D$1' })
    setValidation(sheet, parseRangeList('A1:A3 A5'), undefined)
    sheet.setCell(5, 1, { v: 100 })
    sheet.setCell(0, 3, { v: 2 })
    const rule = validationAt(sheet, 5, 0)!
    const calc = new SheetCalc(book)
    try { expect(evaluateRuleFormula(sheet, calc, rule.formula1!, ruleAnchor(sheet, rule.ranges)!, 5, 0)).toBe(102) }
    finally { calc.destroy() }
  })
})
