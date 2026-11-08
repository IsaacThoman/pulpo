import { WorkbookModel } from '@pulpo/client-core/office/sheets'
import type { FunctionDoc, SheetSummary, SheetView, ValidationRule } from '@pulpo/client-core/office/sheets/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { aggregateText, aggregateValue, AGGREGATE_STORAGE_KEY, readAggregate, shownAggregate, writeAggregate } from './aggregates'
import { functionGroups, insertFunction, runCommonFunction } from './functions'
import { acceptWorkbookLocation, linkDialogUrl, linkFromDialog, workbookLocation } from './sheet-links'
import { guessHeader, sortedRows } from './sort-range'
import { absoluteRange, draftFromRule, EMPTY_DRAFT, ruleFromDraft, validationTarget, type ValidationDraft } from './validation-criteria'

afterEach(() => {
  vi.unstubAllGlobals()
})

function workbook(): WorkbookModel {
  const book = WorkbookModel.initialize(new Y.Doc())
  book.addSheet('Sheet1')
  book.addSheet('Q1 plan')
  book.names.set('totals', { name: 'Totals', formula: "'Q1 plan'!$B$2" })
  return book
}

describe('links to places in the workbook', () => {
  it('takes cells, ranges, other sheets and defined names, as the workbook spells them', () => {
    const book = workbook()
    expect(workbookLocation(book, 'b2')).toBe('B2')
    expect(workbookLocation(book, '$A$1:$C$3')).toBe('A1:C3')
    expect(workbookLocation(book, 'sheet1!a1')).toBe('Sheet1!A1')
    expect(workbookLocation(book, "#'q1 PLAN'!b4")).toBe("'Q1 plan'!B4")
    expect(workbookLocation(book, 'totals')).toBe('Totals')
  })

  it('leaves web addresses and unknown sheets to the dialog’s own checks', () => {
    const book = workbook()
    for (const text of ['example.com', 'https://example.com/A1', 'Nope!A1', 'Sheet1!', 'mailto:a@b.co', 'B2 C3']) expect(workbookLocation(book, text)).toBeUndefined()
  })

  it('stores a place as a location and a web address as a target', () => {
    const accept = acceptWorkbookLocation(workbook())
    const place = accept("'Q1 plan'!A1")!
    expect(linkFromDialog(place, '')).toEqual({ location: "'Q1 plan'!A1" })
    expect(accept('example.com')).toBeUndefined()
    expect(linkFromDialog('https://example.com', ' Site ')).toEqual({ target: 'https://example.com', display: 'Site' })
    expect(linkDialogUrl({ location: 'Sheet1!A1' })).toBe('Sheet1!A1')
    expect(linkDialogUrl(undefined)).toBe('')
  })
})

describe('status bar figures', () => {
  const summary: SheetSummary = { count: 4, numbers: 3, sum: 1234.5, average: 411.5, min: 4.5, max: 1000 }

  it('shows each figure and falls back to the count when a selection has no numbers', () => {
    expect(aggregateText('sum', aggregateValue(summary, 'sum'))).toBe('Sum: 1,234.5')
    expect(aggregateText('countNumbers', aggregateValue(summary, 'countNumbers'))).toBe('Count numbers: 3')
    expect(aggregateText('max', aggregateValue(summary, 'max'))).toBe('Max: 1,000')
    const text: SheetSummary = { count: 3, numbers: 0, sum: 0, average: undefined, min: undefined, max: undefined }
    expect(shownAggregate(text, 'sum')).toBe('count')
    expect(shownAggregate(text, 'average')).toBe('count')
    expect(shownAggregate(summary, 'min')).toBe('min')
    expect(aggregateText('average', undefined)).toBe('Average: —')
  })

  it('remembers the choice, and works without storage', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) })
    expect(readAggregate()).toBe('sum')
    writeAggregate('max')
    expect(store.get(AGGREGATE_STORAGE_KEY)).toBe('max')
    expect(readAggregate()).toBe('max')
    store.set(AGGREGATE_STORAGE_KEY, 'bogus')
    expect(readAggregate()).toBe('sum')
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(readAggregate()).toBe('sum')
    expect(() => writeAggregate('min')).not.toThrow()
  })
})

describe('function menus', () => {
  const docs: FunctionDoc[] = [
    { name: 'VLOOKUP', category: 'lookup', args: [] },
    { name: 'SUM', category: 'math', args: [] },
    { name: 'ABS', category: 'math', args: [] },
    { name: 'MYSTERY', args: [] },
    { name: 'COUNT', category: 'statistical', args: [] },
  ]

  it('groups functions in Google’s category order, by name', () => {
    expect(functionGroups(docs).map((group) => [group.category, group.functions.map((doc) => doc.name)])).toEqual([
      ['math', ['ABS', 'SUM']],
      ['statistical', ['COUNT']],
      ['lookup', ['VLOOKUP']],
      ['other', ['MYSTERY']],
    ])
  })

  /** A view with just what the function commands use. */
  function fakeView(editing?: { text: string; caret: number }) {
    return {
      readOnly: false,
      valuesOnly: false,
      editing,
      setEditText: vi.fn(),
      beginEdit: vi.fn(),
      autoSum: vi.fn(() => true),
      focus: vi.fn(),
    }
  }

  it('starts a formula, inserts at the caret of one being typed, and turns typed text into one', () => {
    const idle = fakeView()
    insertFunction(idle as unknown as SheetView, 'VLOOKUP')
    expect(idle.beginEdit).toHaveBeenCalledWith('=VLOOKUP(', true)
    const formula = fakeView({ text: '=1+', caret: 3 })
    insertFunction(formula as unknown as SheetView, 'SUM')
    expect(formula.setEditText).toHaveBeenCalledWith('=1+SUM(', 7)
    const text = fakeView({ text: 'abc', caret: 3 })
    insertFunction(text as unknown as SheetView, 'MAX')
    expect(text.setEditText).toHaveBeenCalledWith('=MAX(')
  })

  it('sums with AutoSum when nothing is being typed, and never in CSV', () => {
    const idle = fakeView()
    runCommonFunction(idle as unknown as SheetView, 'AVERAGE')
    expect(idle.autoSum).toHaveBeenCalledWith('AVERAGE')
    const csv = { ...fakeView(), valuesOnly: true }
    runCommonFunction(csv as unknown as SheetView, 'SUM')
    insertFunction(csv as unknown as SheetView, 'SUM')
    expect(csv.autoSum).not.toHaveBeenCalled()
    expect(csv.beginEdit).not.toHaveBeenCalled()
  })
})

describe('sort range options', () => {
  it('guesses a header row of text over numbers and leaves it in place', () => {
    const values: Record<string, unknown> = { '0,0': 'Region', '0,1': 'Q1', '1,0': 'North', '1,1': 10 }
    const view = { valueAt: (row: number, col: number) => values[`${row},${col}`] ?? null, styleAt: () => ({ bold: false }) }
    const area = { top: 0, left: 0, bottom: 3, right: 1 }
    expect(guessHeader(view as unknown as SheetView, area)).toBe(true)
    expect(guessHeader(view as unknown as SheetView, { ...area, top: 1 })).toBe(false)
    expect(sortedRows(area, true)).toEqual({ ...area, top: 1 })
    expect(sortedRows(area, false)).toEqual(area)
    expect(sortedRows({ ...area, bottom: 0 }, true)).toEqual({ ...area, bottom: 0 })
  })
})

describe('data validation criteria', () => {
  const anchor = { row: 1, col: 2 }
  const build = (draft: Partial<ValidationDraft>, existing?: ValidationRule) => ruleFromDraft({ ...EMPTY_DRAFT, ...draft }, anchor, { date1904: false, workbook: workbook(), ...(existing ? { existing } : {}) })

  it('builds a dropdown of items, refusing commas, and hides the arrow when asked', () => {
    expect(build({ values: ['Low\n Medium \n\nHigh', ''] })).toMatchObject({ ok: true, rule: { type: 'list', formula1: '"Low,Medium,High"', errorStyle: 'warning', showErrorMessage: true } })
    expect(build({ values: ['a,b', ''] })).toMatchObject({ ok: false, field: 0 })
    expect(build({ values: ['', ''] })).toMatchObject({ ok: false, field: 0 })
    expect(build({ values: ['Yes\nNo', ''], showDropdown: false, reject: true })).toMatchObject({ ok: true, rule: { showDropDown: true, errorStyle: 'stop' } })
  })

  it('makes a range dropdown absolute, keeps whole columns, and refuses unknown sheets', () => {
    expect(build({ criterion: 'listRange', values: ['d1:d5', ''] })).toMatchObject({ ok: true, rule: { type: 'list', formula1: '$D$1:$D$5' } })
    expect(absoluteRange("'q1 plan'!A2:A9", workbook())).toBe("'Q1 plan'!$A$2:$A$9")
    expect(absoluteRange('D:D')).toBe('$D:$D')
    expect(absoluteRange('Missing!A1:A3', workbook())).toBeUndefined()
    expect(absoluteRange('not a range')).toBeUndefined()
  })

  it('builds number, text, date and custom rules for the anchor cell', () => {
    expect(build({ criterion: 'number-between', values: ['1', '=B1'] })).toMatchObject({ ok: true, rule: { type: 'decimal', operator: 'between', formula1: '1', formula2: 'B1' } })
    expect(build({ criterion: 'number-between', values: ['1', ''] })).toMatchObject({ ok: false, field: 1 })
    expect(build({ criterion: 'text-contains', values: ['say "hi"', ''] })).toMatchObject({ ok: true, rule: { type: 'custom', formula1: 'ISNUMBER(SEARCH("say ""hi""",C2))' } })
    expect(build({ criterion: 'length-lessThanOrEqual', values: ['10', ''] })).toMatchObject({ ok: true, rule: { type: 'textLength', operator: 'lessThanOrEqual', formula1: '10' } })
    expect(build({ criterion: 'date-greaterThan', values: ['2026-12-31', ''] })).toMatchObject({ ok: true, rule: { type: 'date', operator: 'greaterThan', formula1: '46387' } })
    expect(build({ criterion: 'date-lessThan', values: ['someday', ''] })).toMatchObject({ ok: false, field: 0 })
    expect(build({ criterion: 'custom', values: ['=C2>0', ''] })).toMatchObject({ ok: true, rule: { type: 'custom', formula1: 'C2>0' } })
  })

  it('reads a rule back into the dialog, keeping imported information rules and whole numbers', () => {
    const information: ValidationRule = { type: 'whole', operator: 'greaterThan', formula1: '5', errorStyle: 'information', showErrorMessage: true, error: 'Big' }
    const draft = draftFromRule(information, false)
    expect(draft).toMatchObject({ criterion: 'number-greaterThan', values: ['5', ''], reject: false, message: 'Big' })
    expect(ruleFromDraft({ ...draft, values: ['6', ''] }, anchor, { date1904: false, existing: information })).toMatchObject({ ok: true, rule: { type: 'whole', errorStyle: 'information', formula1: '6', error: 'Big' } })
    expect(draftFromRule({ type: 'list', formula1: '"A,B"', showDropDown: true }, false)).toMatchObject({ criterion: 'list', values: ['A\nB', ''], showDropdown: false, reject: true })
    expect(draftFromRule({ type: 'custom', formula1: 'ISERROR(SEARCH("x",C2))' }, false)).toMatchObject({ criterion: 'text-notContains', values: ['x', ''] })
    expect(draftFromRule({ type: 'time', operator: 'between', formula1: '0.25', formula2: '0.5' }, false).criterion).toBe('existing')
  })

  it('edits the rule the whole selection is in, and otherwise starts a new one on the selection', () => {
    const rule: ValidationRule = { type: 'list', formula1: '"A,B"' }
    const state = { activeValidation: { id: 'r1', rule, ranges: [{ top: 0, left: 0, bottom: 9, right: 0 }] } }
    const inside = { getState: () => state, selection: { ranges: [{ top: 2, left: 0, bottom: 4, right: 0 }] } }
    expect(validationTarget(inside as unknown as SheetView)).toMatchObject({ ruleId: 'r1', rule })
    const across = { getState: () => state, selection: { ranges: [{ top: 2, left: 0, bottom: 4, right: 1 }] } }
    expect(validationTarget(across as unknown as SheetView)).toEqual({ ranges: across.selection.ranges })
  })
})
