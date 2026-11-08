import type { Alignment, LineSpacing, ParagraphFormat, ParagraphFormatChange } from '@pulpo/client-core/office/docx/view'
import { ui } from '@/i18n/ui'
import { formatNumber, parseLength, parseNumber, pointsTo, type LengthUnit } from './page-units'

export type SpecialIndent = 'none' | 'firstLine' | 'hanging'
export type LineRule = 'single' | 'oneHalf' | 'double' | 'multiple' | 'exact' | 'atLeast'

/** What opened the dialog: Format ▸ Paragraph…, Indentation options…, Custom spacing…, or the breaks tab. */
export type ParagraphDialogFocus = 'indents' | 'spacing' | 'breaks'

export interface ParagraphFields {
  alignment: Alignment
  left: string
  right: string
  special: SpecialIndent
  by: string
  before: string
  after: string
  rule: LineRule
  at: string
  keepNext: boolean
  keepLines: boolean
  pageBreakBefore: boolean
  widowControl: boolean
}

export type Flag = 'keepNext' | 'keepLines' | 'pageBreakBefore' | 'widowControl'
export const FLAGS: readonly Flag[] = ['widowControl', 'keepNext', 'keepLines', 'pageBreakBefore']

function lineRule(line: LineSpacing): { rule: LineRule; at: number } {
  if ('exact' in line) return { rule: 'exact', at: line.exact }
  if ('atLeast' in line) return { rule: 'atLeast', at: line.atLeast }
  const multiple = line.multiple
  if (Math.abs(multiple - 1) < 0.005) return { rule: 'single', at: 1 }
  if (Math.abs(multiple - 1.5) < 0.005) return { rule: 'oneHalf', at: 1.5 }
  if (Math.abs(multiple - 2) < 0.005) return { rule: 'double', at: 2 }
  return { rule: 'multiple', at: multiple }
}

/** The dialog's fields for a paragraph's format: indents in `unit`, spacing in points. */
export function paragraphFields(format: ParagraphFormat, unit: LengthUnit, locale?: string): ParagraphFields {
  const number = (value: number) => formatNumber(value, locale)
  const { rule, at } = lineRule(format.spacing.line)
  const special: SpecialIndent = format.indent.hanging > 0 ? 'hanging' : format.indent.firstLine > 0 ? 'firstLine' : 'none'
  return {
    alignment: format.alignment,
    left: number(pointsTo(format.indent.left, unit)),
    right: number(pointsTo(format.indent.right, unit)),
    special,
    by: number(pointsTo(special === 'hanging' ? format.indent.hanging : special === 'firstLine' ? format.indent.firstLine : 0, unit)),
    before: number(format.spacing.before),
    after: number(format.spacing.after),
    rule,
    at: number(at),
    keepNext: format.keepNext,
    keepLines: format.keepLines,
    pageBreakBefore: format.pageBreakBefore,
    widowControl: format.widowControl,
  }
}

export type FieldError = { field: keyof ParagraphFields; message: string }

/**
 * The change the fields ask for, against what the dialog opened with: only what the person
 * changed is written, so paragraphs with different formats keep the rest, as in Word.
 */
export function paragraphChange(initial: ParagraphFields, fields: ParagraphFields, unit: LengthUnit): { change: ParagraphFormatChange } | { error: FieldError } {
  const change: ParagraphFormatChange = {}
  const length = (field: 'left' | 'right' | 'by', negative = true): { value: number } | { error: FieldError } => {
    const value = parseLength(fields[field], unit)
    if (value === null || (!negative && value < 0)) return { error: { field, message: negative ? ui("Enter a length, like 0.5.") : ui("Enter a length of 0 or more.") } }
    return { value }
  }
  const points = (field: 'before' | 'after'): { value: number } | { error: FieldError } => {
    const value = parseNumber(fields[field].replace(/\s*pt$/i, ''))
    if (value === null || value < 0 || value > 1584) return { error: { field, message: ui("Enter a number of points from 0 to 1584.") } }
    return { value }
  }
  if (fields.alignment !== initial.alignment) change.alignment = fields.alignment

  const indent: NonNullable<ParagraphFormatChange['indent']> = {}
  if (fields.left !== initial.left) {
    const left = length('left')
    if ('error' in left) return left
    indent.left = left.value
  }
  if (fields.right !== initial.right) {
    const right = length('right')
    if ('error' in right) return right
    indent.right = right.value
  }
  if (fields.special !== initial.special || fields.by !== initial.by) {
    if (fields.special === 'none') indent.firstLine = 0
    else {
      const by = length('by', false)
      if ('error' in by) return by
      if (fields.special === 'hanging') indent.hanging = by.value
      else indent.firstLine = by.value
    }
  }
  if (Object.keys(indent).length) change.indent = indent

  const spacing: NonNullable<ParagraphFormatChange['spacing']> = {}
  if (fields.before !== initial.before) {
    const before = points('before')
    if ('error' in before) return before
    spacing.before = before.value
  }
  if (fields.after !== initial.after) {
    const after = points('after')
    if ('error' in after) return after
    spacing.after = after.value
  }
  if (fields.rule !== initial.rule || fields.at !== initial.at) {
    if (fields.rule === 'single') spacing.line = { multiple: 1 }
    else if (fields.rule === 'oneHalf') spacing.line = { multiple: 1.5 }
    else if (fields.rule === 'double') spacing.line = { multiple: 2 }
    else {
      const at = parseNumber(fields.at.replace(/\s*pt$/i, ''))
      if (fields.rule === 'multiple') {
        if (at === null || at < 0.06 || at > 132) return { error: { field: 'at', message: ui("Enter a multiple from 0.06 to 132.") } }
        spacing.line = { multiple: at }
      } else {
        if (at === null || at < 0.7 || at > 1584) return { error: { field: 'at', message: ui("Enter a height from 0.7 to 1584 points.") } }
        spacing.line = fields.rule === 'exact' ? { exact: at } : { atLeast: at }
      }
    }
  }
  if (Object.keys(spacing).length) change.spacing = spacing

  for (const flag of FLAGS) if (fields[flag] !== initial[flag]) change[flag] = fields[flag]
  return { change }
}
