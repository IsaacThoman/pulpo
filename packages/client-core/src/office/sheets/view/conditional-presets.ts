import type { CfValue, SheetColor } from '../model/schema.js'
import type { ConditionalStyle } from '../styles/stylesheet.js'
import type { ConditionalRuleInput } from './sheet-view.js'

/**
 * Ready-made conditional format rules for menus, matching Excel's Conditional Formatting gallery
 * and Google Sheets' presets. Pass them to `SheetView.addConditionalRule`. Color scales, data bars
 * and icon sets need no stylesheet entry; highlight rules use a preset style.
 */

const rgb = (hex: string): SheetColor => ({ rgb: `FF${hex}` })
const MIN: CfValue = { type: 'min' }
const MAX: CfValue = { type: 'max' }
const MID: CfValue = { type: 'percentile', value: '50' }

export type ColorScalePreset = 'greenYellowRed' | 'redYellowGreen' | 'greenWhiteRed' | 'redWhiteGreen' | 'blueWhiteRed' | 'redWhiteBlue' | 'whiteGreen' | 'whiteRed' | 'greenWhite' | 'redWhite'

/** Colors from the lowest value to the highest; Excel's names read from the highest down. */
const SCALE_COLORS: Record<ColorScalePreset, string[]> = {
  greenYellowRed: ['F8696B', 'FFEB84', '63BE7B'],
  redYellowGreen: ['63BE7B', 'FFEB84', 'F8696B'],
  greenWhiteRed: ['F8696B', 'FCFCFF', '63BE7B'],
  redWhiteGreen: ['63BE7B', 'FCFCFF', 'F8696B'],
  blueWhiteRed: ['F8696B', 'FCFCFF', '5A8AC6'],
  redWhiteBlue: ['5A8AC6', 'FCFCFF', 'F8696B'],
  whiteGreen: ['63BE7B', 'FCFCFF'],
  whiteRed: ['F8696B', 'FCFCFF'],
  greenWhite: ['FCFCFF', '63BE7B'],
  redWhite: ['FCFCFF', 'F8696B'],
}

/** Excel's color scale gallery: three colors through the median, or two. */
export function colorScaleRule(preset: ColorScalePreset): ConditionalRuleInput {
  const colors = SCALE_COLORS[preset]
  return { type: 'colorScale', colorScale: { values: colors.length === 3 ? [MIN, MID, MAX] : [MIN, MAX], colors: colors.map(rgb) } }
}

export type DataBarPreset = 'blue' | 'green' | 'red' | 'orange' | 'lightBlue' | 'purple'

const BAR_COLORS: Record<DataBarPreset, string> = { blue: '638EC6', green: '63C384', red: 'FF555A', orange: 'FFB628', lightBlue: '008AEF', purple: 'D6007B' }

export function dataBarRule(preset: DataBarPreset): ConditionalRuleInput {
  return { type: 'dataBar', dataBar: { values: [MIN, MAX], color: rgb(BAR_COLORS[preset]) } }
}

/** Excel's icon set names (what the renderer draws and OOXML stores). */
export type IconSetPreset = '3Arrows' | '3ArrowsGray' | '3TrafficLights1' | '3Signs' | '3Symbols' | '3Flags' | '3Stars' | '4Arrows' | '4TrafficLights' | '4Rating' | '5Arrows' | '5Rating' | '5Quarters'

export function iconSetRule(set: IconSetPreset): ConditionalRuleInput {
  const count = Number(set[0])
  // Equal percent bands, as Excel's gallery sets them up.
  const values: CfValue[] = Array.from({ length: count }, (_, index) => ({ type: 'percent', value: String(Math.round((index * 100) / count)) }))
  return { type: 'iconSet', iconSet: { set, values } }
}

export type HighlightKind =
  | 'greaterThan' | 'lessThan' | 'between' | 'equal' | 'notEqual' | 'greaterThanOrEqual' | 'lessThanOrEqual'
  | 'textContains' | 'textNotContains' | 'beginsWith' | 'endsWith'
  | 'duplicateValues' | 'uniqueValues' | 'top' | 'bottom' | 'topPercent' | 'bottomPercent'
  | 'aboveAverage' | 'belowAverage' | 'blanks' | 'notBlanks' | 'errors'

/**
 * Excel's Highlight Cells Rules and Top/Bottom Rules. `values` are what the user typed: numbers,
 * text, or formulas (A1 text for the top-left selected cell); a rank for top/bottom rules.
 */
export function highlightRule(kind: HighlightKind, values: string[], style: ConditionalStyle = 'lightRedFillDarkRedText'): ConditionalRuleInput {
  const [first = '', second = ''] = values
  // A typed value that is neither a number nor a formula compares as text.
  const operand = (value: string) => {
    const text = value.trim()
    if (text.startsWith('=')) return text.slice(1)
    return text !== '' && !Number.isNaN(Number(text)) ? text : `"${text.replace(/"/g, '""')}"`
  }
  const cellIs = (operator: string, operands: string[]): ConditionalRuleInput => ({ type: 'cellIs', operator, formulas: operands.map(operand), style })
  switch (kind) {
    case 'greaterThan':
    case 'lessThan':
    case 'equal':
    case 'notEqual':
    case 'greaterThanOrEqual':
    case 'lessThanOrEqual':
      return cellIs(kind, [first])
    case 'between':
      return cellIs('between', [first, second])
    case 'textContains':
      return { type: 'containsText', operator: 'containsText', text: first, style }
    case 'textNotContains':
      return { type: 'notContainsText', operator: 'notContains', text: first, style }
    case 'beginsWith':
      return { type: 'beginsWith', operator: 'beginsWith', text: first, style }
    case 'endsWith':
      return { type: 'endsWith', operator: 'endsWith', text: first, style }
    case 'duplicateValues':
      return { type: 'duplicateValues', style }
    case 'uniqueValues':
      return { type: 'uniqueValues', style }
    case 'top':
    case 'bottom':
    case 'topPercent':
    case 'bottomPercent': {
      const rank = Math.max(1, Math.min(1000, Math.round(Number(first) || 10)))
      return { type: 'top10', rank, ...(kind.endsWith('Percent') ? { percent: true } : {}), ...(kind.startsWith('bottom') ? { bottom: true } : {}), style }
    }
    case 'aboveAverage':
      return { type: 'aboveAverage', style }
    case 'belowAverage':
      return { type: 'aboveAverage', aboveAverage: false, style }
    case 'blanks':
      return { type: 'containsBlanks', style }
    case 'notBlanks':
      return { type: 'notContainsBlanks', style }
    case 'errors':
      return { type: 'containsErrors', style }
  }
}

/** Banded rows (Google's Alternating colors, as a rule): every other row gets a light fill. */
export function alternatingRowsRule(style: ConditionalStyle = 'alternateFill'): ConditionalRuleInput {
  return { type: 'expression', formulas: ['MOD(ROW(),2)=0'], style }
}

/** A custom formula rule ("Use a formula to determine which cells to format"). */
export function formulaRule(formula: string, style: ConditionalStyle = 'lightRedFillDarkRedText'): ConditionalRuleInput {
  return { type: 'expression', formulas: [formula], style }
}
