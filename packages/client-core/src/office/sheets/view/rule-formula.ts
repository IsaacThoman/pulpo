import type { CellRange } from '../address.js'
import { toA1Form } from '../model/formula-ids.js'
import { shiftFormula } from '../model/references.js'
import type { CellData, RangeIds } from '../model/schema.js'
import type { SheetModel } from '../model/workbook.js'
import type { CellValue, SheetValues } from '../values.js'

/** ECMA-376 sqref formulas use the first rectangle's top-left, even for later rectangles. */
export function ruleAnchor(sheet: SheetModel, ranges: RangeIds[]): CellRange | undefined {
  for (const ids of ranges) {
    const range = sheet.resolveRange(ids)
    if (range) return range
  }
  return undefined
}

export function ruleFormula(sheet: SheetModel, formula: string, anchor: Pick<CellRange, 'top' | 'left'>, row: number, col: number): string {
  return shiftFormula(toA1Form(formula, sheet, sheet.workbook, { followDeletedRelative: true }), row - anchor.top, col - anchor.left)
}

/** Translate before evaluation: the evaluator's position alone does not move explicit references. */
export function evaluateRuleFormula(sheet: SheetModel, values: SheetValues, formula: string, anchor: Pick<CellRange, 'top' | 'left'>, row: number, col: number, input?: CellData): CellValue | CellValue[][] | undefined {
  const text = ruleFormula(sheet, formula, anchor, row, col)
  return input === undefined ? literalValue(text) ?? values.evaluate?.(sheet, row, col, text) : values.evaluate?.(sheet, row, col, text, input)
}

/** Literal operands can also be read without a calculation engine. */
export function literalValue(formula: string): CellValue | undefined {
  const text = formula.trim().replace(/^=/, '')
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return Number(text)
  if (/^"(?:[^"]|"")*"$/.test(text)) return text.slice(1, -1).replace(/""/g, '"')
  if (/^(TRUE|FALSE)$/i.test(text)) return text.toUpperCase() === 'TRUE'
  return undefined
}
