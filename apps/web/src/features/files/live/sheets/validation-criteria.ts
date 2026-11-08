import { cellName, columnIndex, formatValue, parseInput, parseRangeName, quoteSheetName, rangeContains, type CellRange, type WorkbookModel } from '@pulpo/client-core/office/sheets'
import { listValidationFormula, listValidationTooLong, literalListItems, type SheetView, type ValidationRule } from '@pulpo/client-core/office/sheets/view'
import { ui } from '@/i18n/ui'

/** The rule being edited in place (the selection is inside one rule), or the selection a new rule covers. */
export interface ValidationTarget {
  ruleId?: string
  rule?: ValidationRule
  ranges: CellRange[]
}

const covers = (outer: CellRange, inner: CellRange) => rangeContains(outer, inner.top, inner.left) && rangeContains(outer, inner.bottom, inner.right)

/**
 * Google's rule panel: a selection inside one rule edits that rule in place, ranges and all;
 * anything else gets a new rule over the selection.
 */
export function validationTarget(view: Pick<SheetView, 'getState' | 'selection'>): ValidationTarget {
  const active = view.getState().activeValidation
  if (active && view.selection.ranges.every((range) => active.ranges.some((ruleRange) => covers(ruleRange, range)))) {
    return { ruleId: active.id, rule: active.rule, ranges: active.ranges }
  }
  return { ranges: view.selection.ranges }
}

/**
 * Google Sheets' data validation criteria ("Dropdown", "Is between", "Text contains", "Date is
 * before", "Custom formula is"), as the Excel rules a file can store: lists, decimal and text
 * length comparisons, dates, and custom formulas (text tests are custom formulas, as Google writes
 * them to Excel files).
 */
export type CriterionId =
  | 'list' | 'listRange'
  | 'number-between' | 'number-notBetween' | 'number-greaterThan' | 'number-greaterThanOrEqual' | 'number-lessThan' | 'number-lessThanOrEqual' | 'number-equal' | 'number-notEqual'
  | 'text-contains' | 'text-notContains' | 'text-exactly'
  | 'length-lessThanOrEqual' | 'length-greaterThanOrEqual' | 'length-between'
  | 'date-valid' | 'date-lessThan' | 'date-greaterThan' | 'date-lessThanOrEqual' | 'date-greaterThanOrEqual' | 'date-between'
  | 'custom'
  /** A rule this dialog has no criterion for (an imported time rule, say): kept as it is. */
  | 'existing'

export type ValueKind = 'items' | 'range' | 'number' | 'text' | 'date' | 'formula' | 'none'

export interface Criterion {
  id: CriterionId
  label: () => string
  /** What the inputs hold, and how many there are (two for between). */
  kind: ValueKind
  values: 0 | 1 | 2
  /** Menus separate the groups (lists, numbers, text, dates, custom). */
  group: number
}

export const CRITERIA: readonly Criterion[] = [
  { id: 'list', label: () => ui("Dropdown"), kind: 'items', values: 1, group: 0 },
  { id: 'listRange', label: () => ui("Dropdown (from a range)"), kind: 'range', values: 1, group: 0 },
  { id: 'number-between', label: () => ui("Is between"), kind: 'number', values: 2, group: 1 },
  { id: 'number-notBetween', label: () => ui("Is not between"), kind: 'number', values: 2, group: 1 },
  { id: 'number-equal', label: () => ui("Is equal to"), kind: 'number', values: 1, group: 1 },
  { id: 'number-notEqual', label: () => ui("Is not equal to"), kind: 'number', values: 1, group: 1 },
  { id: 'number-greaterThan', label: () => ui("Is greater than"), kind: 'number', values: 1, group: 1 },
  { id: 'number-greaterThanOrEqual', label: () => ui("Is greater than or equal to"), kind: 'number', values: 1, group: 1 },
  { id: 'number-lessThan', label: () => ui("Is less than"), kind: 'number', values: 1, group: 1 },
  { id: 'number-lessThanOrEqual', label: () => ui("Is less than or equal to"), kind: 'number', values: 1, group: 1 },
  { id: 'text-contains', label: () => ui("Text contains"), kind: 'text', values: 1, group: 2 },
  { id: 'text-notContains', label: () => ui("Text does not contain"), kind: 'text', values: 1, group: 2 },
  { id: 'text-exactly', label: () => ui("Text is exactly"), kind: 'text', values: 1, group: 2 },
  { id: 'length-lessThanOrEqual', label: () => ui("Text length is at most"), kind: 'number', values: 1, group: 2 },
  { id: 'length-greaterThanOrEqual', label: () => ui("Text length is at least"), kind: 'number', values: 1, group: 2 },
  { id: 'length-between', label: () => ui("Text length is between"), kind: 'number', values: 2, group: 2 },
  { id: 'date-valid', label: () => ui("Is valid date"), kind: 'none', values: 0, group: 3 },
  { id: 'date-lessThan', label: () => ui("Date is before"), kind: 'date', values: 1, group: 3 },
  { id: 'date-lessThanOrEqual', label: () => ui("Date is on or before"), kind: 'date', values: 1, group: 3 },
  { id: 'date-greaterThan', label: () => ui("Date is after"), kind: 'date', values: 1, group: 3 },
  { id: 'date-greaterThanOrEqual', label: () => ui("Date is on or after"), kind: 'date', values: 1, group: 3 },
  { id: 'date-between', label: () => ui("Date is between"), kind: 'date', values: 2, group: 3 },
  { id: 'custom', label: () => ui("Custom formula is"), kind: 'formula', values: 1, group: 4 },
]

export const EXISTING_CRITERION: Criterion = { id: 'existing', label: () => ui("Current rule (unchanged)"), kind: 'none', values: 0, group: 5 }

export function criterion(id: CriterionId): Criterion {
  return CRITERIA.find((entry) => entry.id === id) ?? EXISTING_CRITERION
}

/** What the dialog edits: the criterion, its inputs as typed, and the appearance options. */
export interface ValidationDraft {
  criterion: CriterionId
  /** For `items`, one item per line. */
  values: [string, string]
  showDropdown: boolean
  reject: boolean
  message: string
}

export const EMPTY_DRAFT: ValidationDraft = { criterion: 'list', values: ['', ''], showDropdown: true, reject: false, message: '' }

/** Excel's limit on a validation's error message: a longer one makes it refuse the file. */
export const MAX_VALIDATION_MESSAGE_LENGTH = 255

/** A text value as a formula string literal. */
const quoted = (text: string) => `"${text.replace(/"/g, '""')}"`

const TEXT_TESTS: [CriterionId, RegExp][] = [
  ['text-contains', /^ISNUMBER\(SEARCH\("((?:[^"]|"")*)",\$?[A-Z]{1,3}\$?\d+\)\)$/i],
  ['text-notContains', /^ISERROR\(SEARCH\("((?:[^"]|"")*)",\$?[A-Z]{1,3}\$?\d+\)\)$/i],
  ['text-exactly', /^EXACT\(\$?[A-Z]{1,3}\$?\d+,"((?:[^"]|"")*)"\)$/i],
]

/** A date bound as the dialog shows it: the serial as a date, or the formula. */
function dateText(formula: string | undefined, date1904: boolean): string {
  if (!formula) return ''
  if (/^-?\d+(\.\d+)?$/.test(formula.trim())) return formatValue(Number(formula), 'm/d/yyyy', { date1904 }).text
  return `=${formula}`
}

const boundText = (formula: string | undefined) => formula === undefined ? '' : /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(formula.trim()) ? formula.trim() : `=${formula}`

/** The draft showing an existing rule (formulas as A1 text for its top-left cell). */
export function draftFromRule(rule: ValidationRule, date1904: boolean): ValidationDraft {
  const appearance = {
    showDropdown: rule.showDropDown !== true,
    reject: (rule.errorStyle ?? 'stop') === 'stop' && rule.showErrorMessage !== false,
    message: rule.error ?? '',
  }
  const operator = rule.operator ?? 'between'
  const two = (first: string, second: string): [string, string] => [first, second]
  switch (rule.type) {
    case 'list': {
      const items = literalListItems(rule.formula1)
      return items ? { criterion: 'list', values: two(items.join('\n'), ''), ...appearance } : { criterion: 'listRange', values: two(rule.formula1 ?? '', ''), ...appearance }
    }
    case 'decimal':
    case 'whole': {
      const id = `number-${operator}` as CriterionId
      if (CRITERIA.some((entry) => entry.id === id)) return { criterion: id, values: two(boundText(rule.formula1), boundText(rule.formula2)), ...appearance }
      break
    }
    case 'textLength': {
      const id = `length-${operator}` as CriterionId
      if (CRITERIA.some((entry) => entry.id === id)) return { criterion: id, values: two(boundText(rule.formula1), boundText(rule.formula2)), ...appearance }
      break
    }
    case 'date': {
      if (operator === 'greaterThanOrEqual' && (rule.formula1 ?? '').trim() === '0') return { criterion: 'date-valid', values: two('', ''), ...appearance }
      const id = `date-${operator}` as CriterionId
      if (CRITERIA.some((entry) => entry.id === id)) return { criterion: id, values: two(dateText(rule.formula1, date1904), dateText(rule.formula2, date1904)), ...appearance }
      break
    }
    case 'custom': {
      const formula = (rule.formula1 ?? '').trim()
      for (const [id, pattern] of TEXT_TESTS) {
        const match = pattern.exec(formula)
        if (match) return { criterion: id, values: two(match[1]!.replace(/""/g, '"'), ''), ...appearance }
      }
      return { criterion: 'custom', values: two(formula ? `=${formula}` : '', ''), ...appearance }
    }
  }
  return { criterion: 'existing', values: two('', ''), ...appearance }
}

export type BuildResult = { ok: true; rule: ValidationRule } | { ok: false; error: string; field: 0 | 1 }

/** A number bound: a number, or a formula typed with `=`. */
function numberBound(text: string): string | undefined {
  const value = text.trim()
  if (value.startsWith('=') && value.length > 1) return value.slice(1)
  return value !== '' && Number.isFinite(Number(value)) ? String(Number(value)) : undefined
}

/** A date bound: a typed date as its serial number, or a formula typed with `=`. */
function dateBound(text: string, date1904: boolean): string | undefined {
  const value = text.trim()
  if (value.startsWith('=') && value.length > 1) return value.slice(1)
  if (!value) return undefined
  const parsed = parseInput(value, { date1904 })
  return typeof parsed.value === 'number' ? String(parsed.value) : undefined
}

/**
 * "D1:D5" or "Sheet2!D1:D5" as an absolute reference, so every validated cell lists the same
 * range. With `workbook`, a sheet it doesn't have is refused (and spelled as the workbook does).
 */
export function absoluteRange(text: string, workbook?: Pick<WorkbookModel, 'sheetByName'>): string | undefined {
  const value = text.trim().replace(/^=/, '')
  const bang = value.lastIndexOf('!')
  const sheet = bang > 0 ? value.slice(0, bang) : undefined
  const reference = (bang > 0 ? value.slice(bang + 1) : value).replace(/\$/g, '')
  const range = parseRangeName(reference)
  if (!range) return undefined
  let sheetName = sheet === undefined ? undefined : sheet.replace(/^'|'$/g, '').replace(/''/g, "'")
  if (sheetName !== undefined && workbook) {
    const found = workbook.sheetByName(sheetName)
    if (!found) return undefined
    sheetName = found.name
  }
  const prefix = sheetName === undefined ? '' : `${quoteSheetName(sheetName)}!`
  const corner = (row: number, col: number) => cellName(row, col).replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2')
  const [first, second] = reference.split(':')
  // Whole columns (D:D) and whole rows (1:5) stay that shape.
  if (second !== undefined && columnIndex(first!) >= 0 && columnIndex(second) >= 0 && !/\d/.test(first! + second)) return `${prefix}$${first!.toUpperCase()}:$${second.toUpperCase()}`
  if (second !== undefined && /^\d+$/.test(first!) && /^\d+$/.test(second)) return `${prefix}$${first}:$${second}`
  return `${prefix}${corner(range.top, range.left)}${range.top === range.bottom && range.left === range.right ? '' : `:${corner(range.bottom, range.right)}`}`
}

/**
 * The rule the draft describes, with formulas written for `anchor` (the top-left cell of the
 * rule's first range); `existing` supplies the rule kept by the 'existing' criterion and the
 * settings the dialog doesn't show.
 */
export function ruleFromDraft(draft: ValidationDraft, anchor: { row: number; col: number }, options: { date1904: boolean; existing?: ValidationRule; workbook?: Pick<WorkbookModel, 'sheetByName'> }): BuildResult {
  const { values } = draft
  const cell = cellName(anchor.row, anchor.col)
  const base: Partial<ValidationRule> = {
    allowBlank: options.existing?.allowBlank ?? true,
    showErrorMessage: true,
    // An imported information rule (OK/Cancel) stays one; Google's warning is Excel's Yes/No/Cancel.
    errorStyle: draft.reject ? 'stop' : options.existing?.errorStyle === 'information' ? 'information' : 'warning',
    // Excel refuses a file with a longer message.
    ...(draft.message.trim() ? { error: draft.message.trim().slice(0, MAX_VALIDATION_MESSAGE_LENGTH) } : {}),
    ...(options.existing?.errorTitle ? { errorTitle: options.existing.errorTitle } : {}),
    ...(options.existing?.prompt ? { prompt: options.existing.prompt } : {}),
    ...(options.existing?.promptTitle ? { promptTitle: options.existing.promptTitle } : {}),
    ...(options.existing?.showInputMessage !== undefined ? { showInputMessage: options.existing.showInputMessage } : {}),
  }
  const done = (rule: Pick<ValidationRule, 'type'> & Partial<ValidationRule>): BuildResult => ({ ok: true, rule: { ...base, ...rule } })
  const needed = (field: 0 | 1, error: string): BuildResult => ({ ok: false, error, field })
  const id = draft.criterion
  const spec = criterion(id)
  if (id === 'existing') {
    const existing = options.existing
    if (!existing) return needed(0, ui("Choose a rule."))
    const { type, operator, formula1, formula2, keep } = existing
    return done({ type, ...(operator ? { operator } : {}), ...(formula1 !== undefined ? { formula1 } : {}), ...(formula2 !== undefined ? { formula2 } : {}), ...(keep ? { keep } : {}), ...(existing.showDropDown ? { showDropDown: true } : {}) })
  }
  const dropdown = draft.showDropdown ? {} : { showDropDown: true }
  if (id === 'list') {
    const items = values[0].split('\n').map((item) => item.trim()).filter(Boolean)
    if (!items.length) return needed(0, ui("Add at least one item."))
    if (items.some((item) => item.includes(','))) return needed(0, ui("Items can't contain commas."))
    // Excel won't open a file whose list of items runs past 255 characters, as its own dialog says.
    if (listValidationTooLong(items)) return needed(0, ui("Items can have up to 255 characters in all. For a longer list, put the items in cells and choose Dropdown (from a range)."))
    const formula1 = listValidationFormula(items)
    if (!formula1) return needed(0, ui("Add at least one item."))
    return done({ type: 'list', formula1, ...dropdown })
  }
  if (id === 'listRange') {
    const formula1 = absoluteRange(values[0], options.workbook)
    if (!formula1) return needed(0, ui("Enter a range, like D1:D5 or Sheet2!A1:A10."))
    return done({ type: 'list', formula1, ...dropdown })
  }
  if (spec.kind === 'text') {
    const text = values[0]
    if (!text) return needed(0, ui("Enter the text."))
    const formula1 = id === 'text-contains' ? `ISNUMBER(SEARCH(${quoted(text)},${cell}))` : id === 'text-notContains' ? `ISERROR(SEARCH(${quoted(text)},${cell}))` : `EXACT(${cell},${quoted(text)})`
    return done({ type: 'custom', formula1 })
  }
  if (id === 'custom') {
    const formula = values[0].trim().replace(/^=/, '')
    if (!formula) return needed(0, ui("Enter a formula, like =A1>0."))
    return done({ type: 'custom', formula1: formula })
  }
  if (id === 'date-valid') return done({ type: 'date', operator: 'greaterThanOrEqual', formula1: '0' })
  const [kind, operator] = id.split('-') as ['number' | 'length' | 'date', string]
  const bound = kind === 'date' ? (text: string) => dateBound(text, options.date1904) : numberBound
  const formula1 = bound(values[0])
  if (formula1 === undefined) return needed(0, kind === 'date' ? ui("Enter a date, like 12/31/2026.") : ui("Enter a number."))
  let formula2: string | undefined
  if (spec.values === 2) {
    formula2 = bound(values[1])
    if (formula2 === undefined) return needed(1, kind === 'date' ? ui("Enter a date, like 12/31/2026.") : ui("Enter a number."))
  }
  // A whole-number rule from a file stays one when only its bounds change.
  const type = kind === 'number' ? (options.existing?.type === 'whole' ? 'whole' : 'decimal') : kind === 'length' ? 'textLength' : 'date'
  return done({ type, operator, formula1, ...(formula2 !== undefined ? { formula2 } : {}) })
}
