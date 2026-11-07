// @vitest-environment jsdom
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { MemoryLiveAssetStore } from '../../assets.js'
import { OoxmlPackage } from '../../ooxml/package.js'
import type { InspectSheet } from '../testing/fidelity.js'
import { toIdForm } from '../model/formula-ids.js'
import { SheetCodec } from '../codec/codec.js'
import { SheetCalc } from '../calc.js'
import { moveAxis } from '../model/structure.js'
import { moveCells } from '../model/move-cells.js'
import { toA1Form } from '../model/formula-ids.js'
import type { AutoFilter, SheetTable } from '../model/schema.js'
import { WorkbookModel } from '../model/workbook.js'
import { SheetView } from './sheet-view.js'
import * as commands from './commands.js'

const views: SheetView[] = []
const awarenesses: Awareness[] = []
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const context = new Proxy({ measureText: (text: string) => ({ width: String(text).length * 7 }), getLineDash: () => [] }, {
    get: (target, key) => target[key as keyof typeof target] ?? (() => {}),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
})
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  for (const awareness of awarenesses.splice(0)) awareness.destroy()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const rect = (top: number, left: number, bottom = top, right = left) => ({ top, left, bottom, right })
function setup(rows: string[][] = [], shared = false) {
  const doc = new Y.Doc()
  const book = WorkbookModel.initialize(doc)
  let sheet = book.addSheet('Sheet1')
  rows.forEach((row, r) => row.forEach((text, c) => commands.setCellInput(sheet, r, c, text)))
  const container = document.createElement('div')
  document.body.appendChild(container)
  const awareness = shared ? new Awareness(doc) : undefined
  if (awareness) awarenesses.push(awareness)
  const assets = new MemoryLiveAssetStore()
  const view = new SheetView({ container, doc, assets, user: { name: 'Test', color: '#123456' }, awareness })
  views.push(view)
  sheet = view.sheet
  const sort = (area = rect(0, 0, rows.length - 1, rows[0]!.length - 1), keys: commands.SortKey[] = [{ col: 0 }], options: commands.SortOptions = {}) => commands.sortRange(sheet, area, keys, (r, c) => view.valueAt(r, c), { values: view.values, display: (r, c) => view.displayText(r, c), ...options })
  const display = (r: number, c: number) => view.displayText(r, c)
  const column = (col = 0, count = rows.length) => Array.from({ length: count }, (_, r) => view.inputText(r, col))
  return { doc, book, sheet, view, assets, sort, display, column }
}

describe('sort and filter audit matrix', () => {
  it.each([
    { name: 'multiple keys and stable ties', input: [['b', '1'], ['a', '2'], ['a', '1'], ['a', '1']], keys: [{ col: 0 }, { col: 1, descending: true }], expected: ['2', '1', '1', '1'] },
    { name: 'case insensitive ties', input: [['b', '0'], ['A', '1'], ['a', '2'], ['B', '3']], keys: [{ col: 0 }], expected: ['1', '2', '0', '3'] },
    { name: 'case sensitive lowercase first', input: [['B', '0'], ['A', '1'], ['a', '2'], ['b', '3']], keys: [{ col: 0 }], expected: ['2', '1', '3', '0'], caseSensitive: true },
  ])('$name', ({ input, keys, expected, caseSensitive }) => {
    const { sort, column } = setup(input)
    sort(undefined, keys, { caseSensitive })
    expect(column(1)).toEqual(expected)
  })

  it.each([false, true])('orders mixed types, blanks and stable errors; descending=%s', (descending) => {
    const { sort, sheet, view } = setup([['pear'], [''], ['2'], ['TRUE'], ['1'], ['#N/A'], ['#DIV/0!'], ['apple'], ['FALSE'], ['']])
    sheet.setCell(9, 0, { f: '""' })
    sort(undefined, [{ col: 0, descending }])
    const result = Array.from({ length: 10 }, (_, row) => view.valueAt(row, 0))
    expect(result).toEqual(descending ? [{ e: '#N/A' }, { e: '#DIV/0!' }, true, false, 'pear', 'apple', 2, 1, null, ''] : [1, 2, 'apple', 'pear', false, true, { e: '#N/A' }, { e: '#DIV/0!' }, null, ''])
  })

  it.each(['dynamic-anchor', 'dynamic-member', 'legacy-anchor', 'legacy-member', 'outside-key'] as const)('rejects arrays atomically (A): %s', (kind) => {
    const { doc, sheet, sort, view } = setup([['3', 'z'], ['2', 'y'], ['1', 'x'], ['0', 'w']])
    const arrayCol = kind === 'outside-key' ? 1 : 0
    for (const row of [1, 2]) sheet.setCell(row, arrayCol, undefined)
    if (kind.startsWith('legacy')) sheet.setCell(0, 0, { f: 'SEQUENCE(3,1,3,-1)', array: { rows: 3, cols: 1 }, spillCache: [[3], [2], [1]] })
    else commands.setCellInput(sheet, 0, kind === 'outside-key' ? 1 : 0, '=SEQUENCE(3,1,3,-1)')
    const before = Y.encodeStateVector(doc)
    const depth = view.undoManager.undoStack.length
    expect(() => sort(rect(kind.endsWith('member') ? 1 : 0, 0, 3, 1))).toThrow(/array/)
    expect(Y.encodeStateVector(doc)).toEqual(before)
    expect(view.undoManager.undoStack.length).toBe(depth)
  })

  it.each(['toolbar', 'menu', 'blocked'] as const)('reports array refusal through the view: %s', (entry) => {
    const { sheet, view, column } = setup([['=SEQUENCE(3,1,3,-1)'], [''], ['']])
    if (entry === 'blocked') sheet.setCell(1, 0, { v: 'block' })
    const before = column()
    view.select(rect(0, 0, 2, 0))
    if (entry === 'menu') view.sortArea(rect(0, 0, 2, 0), [{ col: 0 }])
    else view.sort(false)
    expect(column()).toEqual(before)
    expect(view.root.querySelector('[role="alert"]')?.textContent).toMatch(/array formulas/)
  })

  it('rejects a scalar dynamic formula that would spill after moving', () => {
    const { sort, doc, sheet } = setup([['2', '=IF(ROW()=1,1,SEQUENCE(3))'], ['1', 'plain']])
    const before = Y.encodeStateVector(doc)
    expect(() => sort()).toThrow(/array formulas/)
    expect(Y.encodeStateVector(doc)).toEqual(before)
    expect(sheet.cell(2, 1)).toBeUndefined()
  })

  it('does not infer a header from an unrelated filter on the same row', () => {
    const { sheet, view } = setup([['Fruit', '', '', '3'], ['apple', '', '', '2'], ['pear', '', '', '1']])
    commands.setAutoFilter(sheet, rect(0, 0, 2, 0))
    view.select(rect(0, 3, 2, 3))
    view.sort(false)
    expect([0, 1, 2].map((r) => view.inputText(r, 3))).toEqual(['1', '2', '3'])
  })

  it.each(['outside-key', 'empty-keys', 'multiple-tables', 'table-plus-outside'] as const)('refuses ambiguous boundaries atomically: %s', (kind) => {
    const { doc, sheet, sort } = setup([['3', 'x'], ['2', 'y'], ['1', 'z']])
    if (kind.includes('table')) {
      sheet.tables.set('a', { name: 'A', displayName: 'A', range: sheet.rangeIds(rect(0, 0, 2, 0)), headerRow: false, totalsRow: false, columns: [{ name: 'A' }] })
      if (kind === 'multiple-tables') sheet.tables.set('b', { name: 'B', displayName: 'B', range: sheet.rangeIds(rect(0, 1, 2, 1)), headerRow: false, totalsRow: false, columns: [{ name: 'B' }] })
    }
    const before = Y.encodeStateVector(doc)
    expect(() => sort(undefined, kind === 'empty-keys' ? [] : [{ col: kind === 'outside-key' ? 3 : 0 }])).toThrow(commands.DataOperationError)
    expect(Y.encodeStateVector(doc)).toEqual(before)
  })

  it.each([false, true])('keeps filtered visibility with records and AND predicates (B), descending=%s', (descending) => {
    const { sheet, sort, display, column } = setup([['Fruit', 'Qty'], ['apple', '2'], ['pear', '1'], ['apple', '1']])
    commands.setAutoFilter(sheet, rect(0, 0, 3, 1))
    commands.filterColumn(sheet, 0, ['apple'], display)
    commands.filterColumn(sheet, 1, ['1'], display)
    sort(rect(1, 0, 3, 1), [{ col: 0, descending }])
    const visible = [1, 2, 3].filter((r) => !sheet.rowProp(r, 'hidden'))
    expect(visible.map((r) => [column()[r], column(1)[r]])).toEqual([['apple', '1']])
    commands.filterColumn(sheet, 1, undefined, display)
    expect([1, 2, 3].filter((r) => !sheet.rowProp(r, 'hidden')).map((r) => column()[r])).toEqual(['apple', 'apple'])
    commands.setAutoFilter(sheet, undefined)
    expect([1, 2, 3].map((r) => !!sheet.rowProp(r, 'hidden'))).toEqual([false, false, false])
  })

  it.each(['clear', 'reapply', 'sort'] as const)('uses current predicates after edits: %s', (action) => {
    const { sheet, sort, display } = setup([['Fruit'], ['apple'], ['pear']])
    commands.setAutoFilter(sheet, rect(0, 0, 2, 0))
    commands.filterColumn(sheet, 0, ['apple'], display)
    commands.setCellInput(sheet, 2, 0, 'apple')
    if (action === 'clear') commands.setAutoFilter(sheet, undefined)
    else if (action === 'reapply') commands.filterColumn(sheet, 0, ['apple'], display)
    else sort(rect(1, 0, 2, 0))
    expect([1, 2].map((r) => !!sheet.rowProp(r, 'hidden'))).toEqual([false, false])
  })

  it.each(['before', 'during'] as const)('preserves manually hidden rows when clearing filters: %s', (when) => {
    const { sheet, display } = setup([['Fruit'], ['apple'], ['pear']])
    if (when === 'before') commands.setHidden(sheet, 'row', [1], true)
    commands.setAutoFilter(sheet, rect(0, 0, 2, 0))
    commands.filterColumn(sheet, 0, ['apple'], display)
    if (when === 'during') commands.setHidden(sheet, 'row', [1], true)
    commands.filterColumn(sheet, 0, undefined, display)
    expect(sheet.rowProp(1, 'hidden')).toBe(true)
    commands.setAutoFilter(sheet, undefined)
    expect(sheet.rowProp(1, 'hidden')).toBe(true)
    expect(sheet.rowProp(2, 'hidden')).toBeUndefined()
  })

  it.each([
    { formula: '=A2*10', expected: 'A1*10' },
    { formula: '=$A2*10', expected: '$A1*10' },
    { formula: '=$A$9+A2', expected: '$A$9+A1' },
  ])('rebases same-row relative references, retains absolute refs: $formula', ({ formula, expected }) => {
    const { sort, sheet } = setup([['2', '=A1'], ['1', formula]])
    sort()
    expect(toA1Form(sheet.cell(0, 1)!.f!, sheet)).toBe(expected)
  })

  it.each([
    ['=A1', '#REF!'], ['=Sheet1!A2', 'Sheet1!A1'],
    ['=SUM(A1:A2)', 'SUM(#REF!)'], ['=SUM(A:A)', 'SUM(A:A)'],
  ])('relocates formulas: %s', (formula, expected) => {
    const { sort, sheet } = setup([['2', '=A1'], ['1', formula!]])
    sort()
    expect(toA1Form(sheet.cell(0, 1)!.f!, sheet)).toBe(expected)
  })

  it.each(['manual-hide', 'outline', 'validation', 'conditional-format', 'row-style', 'drawing', 'range-hyperlink', 'filtered-formula'] as const)('allows ordinary metadata: %s', (kind) => {
    const { sheet, sort, display } = setup([['3', 'a'], ['2', 'b'], ['1', 'c']])
    const area = rect(0, 0, 2, 1)
    if (kind === 'manual-hide') commands.setHidden(sheet, 'row', [0], true)
    if (kind === 'outline') sheet.setRowProp([0], 'level', 1)
    if (kind === 'validation') commands.setValidation(sheet, [rect(0, 0)], { type: 'whole', formula1: '1' })
    if (kind === 'conditional-format') sheet.cf.set('cf', { ranges: [sheet.rangeIds(rect(0, 0))], rules: [] })
    if (kind === 'row-style') sheet.setAxisStyle('row', [0], { bold: true })
    if (kind === 'drawing') sheet.drawings.set('image', { from: { row: sheet.rows.idAt(0), col: sheet.cols.idAt(0), rowOff: 0, colOff: 0 } })
    if (kind === 'range-hyperlink') sheet.links.set(sheet.keyAt(0, 0), { target: 'https://example.com', range: sheet.rangeIds(area) })
    if (kind === 'filtered-formula') {
      commands.setAutoFilter(sheet, area)
      commands.filterColumn(sheet, 0, ['2'], display)
      commands.setCellInput(sheet, 2, 1, '=A3')
    }
    sort(kind === 'filtered-formula' ? rect(1, 0, 2, 1) : area)
    if (kind === 'manual-hide') expect(sheet.rowProp(2, 'hidden')).toBe(true)
    if (kind === 'outline') expect(sheet.rowProp(0, 'level')).toBe(1)
    if (kind === 'row-style') expect(sheet.axisOverrides('row', sheet.rows.idAt(0)).bold).toBe(true)
    if (kind === 'drawing') expect(sheet.drawings.get('image')).toMatchObject({ from: { row: sheet.positionRowId(0) } })
    if (kind === 'range-hyperlink') expect(sheet.resolveRange(sheet.linkAt(0, 0)!.range!)).toEqual(area)
    for (const map of [sheet.cf, sheet.dv]) for (const raw of map.values()) expect(sheet.resolveRange((raw as { ranges: never[] }).ranges[0]!)).toEqual(rect(0, 0))
  })

  it('sorts identically sized merged records and refuses uneven merges atomically', () => {
    const { sheet, sort, doc } = setup([['3', ''], ['1', ''], ['2', '']])
    commands.mergeRanges(sheet, [rect(0, 0, 0, 1), rect(1, 0, 1, 1), rect(2, 0, 2, 1)])
    sort()
    expect([0, 1, 2].map((r) => sheet.cell(r, 0)?.v)).toEqual([1, 2, 3])
    commands.mergeRanges(sheet, [rect(0, 0, 1, 1)])
    const before = Y.encodeStateVector(doc)
    expect(() => sort()).toThrow(/same size/)
    expect(Y.encodeStateVector(doc)).toEqual(before)
  })

  it.each([true, false])('sorts only table records, preserving headers, totals and adjacent cells; header=%s', (headerRow) => {
    const { sheet, sort, column } = setup([['Key', 'Detail', 'outside0'], ['2', 'two', 'outside1'], ['1', 'one', 'outside2'], ['Total', '3', 'outside3']])
    const area = rect(headerRow ? 0 : 1, 0, 3, 1)
    sheet.tables.set('table', { name: 'Data', displayName: 'Data', range: sheet.rangeIds(area), headerRow, totalsRow: true, columns: [{ name: 'Key' }, { name: 'Detail' }] })
    sort(rect(1, 0, 2, 0))
    expect(column()).toEqual(['Key', '1', '2', 'Total'])
    expect(column(2)).toEqual(['outside0', 'outside1', 'outside2', 'outside3'])
  })

  it.each([false, true])('honors explicit header selection for all-text data: %s', (header) => {
    const { view, column } = setup([['Fruit'], ['pear'], ['apple']])
    view.select(rect(0, 0, 2, 0))
    view.sort(false, 0, { header })
    expect(column()).toEqual(header ? ['Fruit', 'apple', 'pear'] : ['apple', 'Fruit', 'pear'])
  })

  it.each(['numeric-header', 'filter-header'] as const)('detects known headers: %s', (kind) => {
    const { sheet, view, column } = setup(kind === 'numeric-header' ? [['Quantity'], ['2'], ['1']] : [['Fruit'], ['pear'], ['apple']])
    if (kind === 'filter-header') commands.setAutoFilter(sheet, rect(0, 0, 2, 0))
    view.select(rect(0, 0, 2, 0))
    view.sort(false)
    expect(column()).toEqual(kind === 'numeric-header' ? ['Quantity', '1', '2'] : ['Fruit', 'apple', 'pear'])
  })

  it('moves cell styles, notes and hyperlinks, leaves row heights in place, and undoes once', () => {
    const { sheet, view, column, sort, display } = setup([['Fruit'], ['apple'], ['pear']])
    sheet.setRowProp([1], 'size', 42)
    sheet.setStyle(rect(1, 0), { bold: true })
    commands.setNote(sheet, 1, 0, { author: 'Tester', text: 'apple note' })
    commands.setLink(sheet, 1, 0, { target: 'https://example.com/apple' })
    commands.setAutoFilter(sheet, rect(0, 0, 2, 0))
    commands.filterColumn(sheet, 0, ['apple'], display)
    const depth = view.undoManager.undoStack.length
    sort(rect(1, 0, 2, 0), [{ col: 0, descending: true }])
    expect(view.undoManager.undoStack.length).toBe(depth + 1)
    expect(column()).toEqual(['Fruit', 'pear', 'apple'])
    expect(sheet.rowProp(1, 'hidden')).toBe(true)
    expect(sheet.rowProp(1, 'size')).toBe(42)
    expect(sheet.cellOverrides(sheet.keyAt(2, 0)).bold).toBe(true)
    expect(sheet.notes.get(sheet.keyAt(2, 0))).toMatchObject({ text: 'apple note' })
    expect(sheet.links.get(sheet.keyAt(2, 0))).toMatchObject({ target: 'https://example.com/apple' })
    view.undo()
    expect(column()).toEqual(['Fruit', 'apple', 'pear'])
    expect(sheet.rowProp(2, 'hidden')).toBe(true)
    expect(sheet.rowProp(1, 'hidden')).toBeUndefined()
    expect(sheet.notes.get(sheet.keyAt(1, 0))).toMatchObject({ text: 'apple note' })
  })

  it.each(['custom', 'top10', 'date-group'] as const)('preserves unsupported imported filters by refusing edits: %s', (kind) => {
    const { sheet, doc, sort, display } = setup([['Fruit'], ['pear'], ['apple']])
    sheet.filter.set('value', { range: sheet.rangeIds(rect(0, 0, 2, 0)), columns: [{ col: 0, xml: `<${kind}/>` }] })
    const before = Y.encodeStateVector(doc)
    expect(() => sort(rect(1, 0, 2, 0))).toThrow(/filter/)
    expect(() => commands.filterColumn(sheet, 0, undefined, display)).toThrow(/filter/)
    expect(() => commands.setAutoFilter(sheet, undefined, display)).toThrow(/filter/)
    expect(Y.encodeStateVector(doc)).toEqual(before)
  })

  it.each(['anchor', 'member'] as const)('refuses opaque what-if table formulas: %s', (kind) => {
    const { sheet, doc, sort } = setup([['2', '20'], ['1', '10'], ['0', '0']])
    sheet.setCell(0, 1, { v: 20, keep: { f: { t: 'dataTable', ref: 'B1:B3', r1: 'A1' }, fText: '' } })
    const before = Y.encodeStateVector(doc)
    expect(() => sort(rect(kind === 'anchor' ? 0 : 1, 0, 2, 1))).toThrow(/What-If/)
    expect(Y.encodeStateVector(doc)).toEqual(before)
  })

  it('keeps concurrent manual hides on rows currently filtered out', () => {
    const { doc, sheet, display } = setup([['Fruit'], ['pear'], ['orange']])
    commands.setAutoFilter(sheet, rect(0, 0, 2, 0))
    commands.filterColumn(sheet, 0, ['apple'], display)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const other = new WorkbookModel(peer).sheets()[0]!
    commands.setHidden(sheet, 'row', [1], true)
    commands.setHidden(other, 'row', [2], true)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer))
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    commands.setAutoFilter(sheet, undefined)
    commands.setAutoFilter(other, undefined)
    expect([1, 2].map((r) => !!sheet.rowProp(r, 'hidden'))).toEqual([true, true])
    expect([1, 2].map((r) => !!other.rowProp(r, 'hidden'))).toEqual([true, true])
    peer.destroy()
  })

  it.each(['clear', 'reapply', 'sort'] as const)('does not mistake concurrent losing filters for manual hiding: %s', (action) => {
    const { doc, sheet, display, sort } = setup([['Fruit', 'Qty'], ['apple', '2'], ['pear', '1']])
    commands.setAutoFilter(sheet, rect(0, 0, 2, 1))
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const other = new WorkbookModel(peer).sheets()[0]!
    commands.filterColumn(sheet, 0, ['apple'], display)
    commands.filterColumn(other, 1, ['1'], (r, c) => String(other.cell(r, c)?.v ?? ''))
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer))
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const winning = sheet.filter.get('value') as AutoFilter
    if (action === 'clear') {
      commands.setAutoFilter(sheet, undefined)
      expect([1, 2].map((r) => !!sheet.rowProp(r, 'hidden'))).toEqual([false, false])
    } else {
      if (action === 'reapply') commands.filterColumn(sheet, winning.columns[0]!.col, winning.columns[0]!.values, display)
      else sort(rect(1, 0, 2, 1))
      expect([1, 2].filter((r) => !sheet.rowProp(r, 'hidden'))).toHaveLength(1)
    }
    peer.destroy()
  })

  it.each(['sort', 'filter-menu', 'insert', 'second-sort'] as const)('shared sorts converge with concurrent edits and structure: %s', (entry) => {
    const { view, sheet, doc, column } = setup([['Fruit'], ['pear'], ['apple'], ['orange']], true)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const remote = new WorkbookModel(peer).sheets()[0]!
    const beforeIds = sheet.rows.resolve().ids
    const pearId = remote.rows.idAt(1)
    commands.setCellInput(remote, 1, 0, 'remote pear')
    if (entry === 'insert') commands.insertLines(remote, 'row', 2, 1)
    if (entry === 'second-sort') commands.sortRange(remote, rect(1, 0, 3, 0), [{ col: 0, descending: true }], (r, c) => remote.cell(r, c)?.v ?? null)
    if (entry === 'sort') { view.select(rect(0, 0, 3, 0)); view.sort(false, 0, { header: true }) }
    else view.sortArea(rect(1, 0, 3, 0), [{ col: 0 }])
    expect(view.root.querySelector('[role="alert"]')).toBeNull()
    expect(column()).toEqual(['Fruit', 'apple', 'orange', 'pear'])
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer))
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    expect(sheet.rows.resolve().ids).toEqual(remote.rows.resolve().ids)
    expect(sheet.rows.length).toBe(beforeIds.length + (entry === 'insert' ? 1 : 0))
    for (const id of beforeIds) expect(sheet.rows.indexOf(id)).toBeGreaterThanOrEqual(0)
    expect(sheet.cell(sheet.rows.indexOf(pearId), 0)?.v).toBe('remote pear')
    expect(remote.cell(remote.rows.indexOf(pearId), 0)?.v).toBe('remote pear')
    expect(new Set(sheet.rows.resolve().ids).size).toBe(sheet.rows.length)
    peer.destroy()
  })

  it.each([10, 30])('preserves concurrent formula replacements and positional metadata across opposing sorts, peer=%s', (clientID) => {
    const { doc, sheet, sort } = setup([['2', '=$A$1'], ['3', '=$A$1'], ['1', '=$A$1']])
    sheet.setRowProp([0], 'size', 42)
    sheet.cf.set('cf', { ranges: [sheet.rangeIds(rect(0, 0))], rules: [] })
    const nameId = 'name'
    sheet.workbook.names.set(nameId, { name: 'TopValue', formula: toIdForm('Sheet1!$A$1', sheet) })
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    doc.clientID = 20
    peer.clientID = clientID
    const other = new WorkbookModel(peer).sheets()[0]!
    sort()
    const calc = new SheetCalc(other.workbook)
    commands.sortRange(other, rect(0, 0, 2, 1), [{ col: 0, descending: true }], (r, c) => calc.get(other, r, c), { values: calc })
    for (const [a, b] of [[doc, peer], [peer, doc]]) Y.applyUpdate(a!, Y.encodeStateAsUpdate(b!))
    for (const model of [sheet, other]) {
      expect(sheet.rows.resolve().ids).toEqual(other.rows.resolve().ids)
      for (const r of [0, 1, 2]) expect(toA1Form(model.cell(r, 1)!.f!, model)).toBe('$A$1')
      expect([0, 1, 2].map((r) => model.rowProp(r, 'size'))).toEqual([42, undefined, undefined])
      expect(model.resolveRange((model.cf.get('cf') as { ranges: never[] }).ranges[0]!)).toEqual(rect(0, 0))
      expect(toA1Form(model.workbook.names.get(nameId)!.formula, model)).toBe('Sheet1!$A$1')
    }
    // Sort one replica while the peer replaces a formula cell with plain text.
    const rowId = other.rows.idAt(0)
    commands.setCellInput(other, 0, 1, 'edited')
    sort()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer))
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    expect(sheet.cell(sheet.rows.indexOf(rowId), 1)?.v).toBe('edited')
    expect(other.cell(other.rows.indexOf(rowId), 1)?.v).toBe('edited')
    calc.destroy()
    peer.destroy()
  })

  it('keeps positional anchors through later row insertion, deletion and undo', () => {
    const { sheet, view, sort } = setup([['2', '=A2'], ['3', '=A3'], ['1', '=A1']])
    sheet.setRowProp([0], 'size', 42)
    sheet.cf.set('cf', { ranges: [sheet.rangeIds(rect(0, 0))], rules: [] })
    sort()
    commands.insertLines(sheet, 'row', 0, 1)
    expect(sheet.rowProp(1, 'size')).toBe(42)
    expect(sheet.resolveRange((sheet.cf.get('cf') as { ranges: never[] }).ranges[0]!)).toEqual(rect(1, 0))
    commands.deleteLines(sheet, 'row', 0, 1)
    expect(sheet.rowProp(0, 'size')).toBe(42)
    view.undo()
    expect(sheet.rowProp(1, 'size')).toBe(42)
  })

  it('moves manual hiding only once in a filtered partial-width sort', () => {
    const { sheet, sort, display } = setup([['Header', 'Other'], ['2', 'beside2'], ['1', 'beside1']])
    commands.setAutoFilter(sheet, rect(0, 0, 2, 1))
    commands.setHidden(sheet, 'row', [1], true)
    sort(rect(1, 0, 2, 0))
    commands.setAutoFilter(sheet, undefined, display)
    expect([1, 2].map((r) => !!sheet.rowProp(r, 'hidden'))).toEqual([false, true])
  })

  it.each([10, 30])('retains concurrent positional row height edits during first sort; peer=%s', (clientID) => {
    const { doc, sheet, sort } = setup([['2'], ['1']])
    sheet.setRowProp([0], 'size', 42)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    doc.clientID = 20; peer.clientID = clientID
    const other = new WorkbookModel(peer).sheets()[0]!
    sort()
    other.setRowProp([0], 'size', 55)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer)); Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    expect([0, 1].map((r) => sheet.rowProp(r, 'size'))).toEqual([55, undefined])
    expect(other.rowProp(0, 'size')).toBe(55)
    peer.destroy()
  })

  it('keeps formulas after editing and undo, including on a connected peer', () => {
    const { sheet, sort, view, doc } = setup([['2', '=$A$1'], ['1', '=$A$1']])
    sort()
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const other = new WorkbookModel(peer).sheets()[0]!
    commands.setCellInput(sheet, 0, 1, 'edited')
    view.undo()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    for (const model of [sheet, other]) expect(toA1Form(model.cell(0, 1)!.f!, model)).toBe('$A$1')
    view.redo()
    expect(sheet.cell(0, 1)?.v).toBe('edited')
    peer.destroy()
  })

  it('duplicates effective formulas and row positions and finds their displayed text', () => {
    const { sheet, sort, view } = setup([['2', '=$A$1'], ['1', '=$A$1']])
    sheet.setRowProp([0], 'size', 42)
    sort()
    expect(view.find('$A$1', { formulas: true })).toHaveLength(2)
    const copy = view.workbook.sheet(view.duplicateSheet(sheet.id)!)!
    expect(toA1Form(copy.cell(0, 1)!.f!, copy)).toBe('$A$1')
    expect(copy.rowProp(0, 'size')).toBe(42)
  })

  it('preserves sorted formulas through cut and an unchanged file application', async () => {
    const { sheet, sort, doc, assets } = setup([['2', '=$A$1'], ['1', '=$A$1']])
    sort()
    const codec = new SheetCodec()
    const bytes = await codec.exportFile(doc, { name: 'sort.xlsx', assets })
    await codec.applyFile(doc, bytes, { name: 'sort.xlsx', assets })
    expect(toA1Form(sheet.cell(0, 1)!.f!, sheet)).toBe('$A$1')
    moveCells(sheet, sheet, rect(0, 1), { row: 3, col: 1 })
    expect(toA1Form(sheet.cell(3, 1)!.f!, sheet)).toBe('$A$1')
  })

  it('moves positional row properties with a structural row move', () => {
    const { sheet, sort } = setup([['2'], ['1']])
    sheet.setRowProp([0], 'size', 42)
    sheet.cf.set('cf', { ranges: [sheet.rangeIds(rect(0, 0))], rules: [] })
    sort()
    moveAxis(sheet, 'row', 0, 1, 2)
    expect([0, 1, 2].map((r) => sheet.rowProp(r, 'size'))).toEqual([undefined, undefined, 42])
    expect(sheet.resolveRange((sheet.cf.get('cf') as { ranges: never[] }).ranges[0]!)).toEqual(rect(2, 0))
  })

  it('does not resurrect invalid sorted references after inserting rows', () => {
    const { sheet, sort } = setup([['2', '=A1'], ['3', '=A1'], ['1', '=A1']])
    sort()
    expect(toA1Form(sheet.cell(0, 1)!.f!, sheet)).toBe('#REF!')
    commands.insertLines(sheet, 'row', 0, 3)
    expect(toA1Form(sheet.cell(3, 1)!.f!, sheet)).toBe('#REF!')
  })

  it('removes only selected coverage from positional range hyperlinks after sorting', () => {
    const { sheet, sort } = setup([['2'], ['1']])
    commands.setLink(sheet, 0, 0, { target: 'https://example.com', range: sheet.rangeIds(rect(0, 0, 1, 0)) })
    sort()
    commands.setLink(sheet, 0, 0, undefined)
    expect(sheet.linkAt(0, 0)).toBeUndefined()
    expect(sheet.linkAt(1, 0)?.target).toBe('https://example.com')
    expect(sheet.links.size).toBe(1)
  })

  it.each([false, true])('keeps formulas outside the sort pointing at their original positions, partial=%s', (partial) => {
    const { sheet, sort, book } = setup([['2'], ['1']])
    if (partial) sheet.setCell(0, 2, { v: 'beside' })
    sheet.setCell(5, 0, { f: toIdForm('A1', sheet) })
    const other = book.addSheet('Other')
    other.setCell(0, 0, { f: toIdForm('Sheet1!A1', other) })
    other.workbook.names.set('local', { name: 'Local', scope: other.id, formula: toIdForm('A1', other) })
    other.dv.set('cross', { ranges: [other.rangeIds(rect(0, 0))], type: 'custom', formula1: toIdForm('Sheet1!A1>0', other) })
    other.workbook.names.set('qualified', { name: 'Qualified', scope: other.id, formula: toIdForm('Sheet1!$A$1', other) })
    sort(rect(0, 0, 1, 0))
    expect(toA1Form(sheet.cell(5, 0)!.f!, sheet)).toBe('A1')
    expect(toA1Form(other.cell(0, 0)!.f!, other)).toBe('Sheet1!A1')
    expect(toA1Form(other.workbook.names.get('local')!.formula, other)).toBe('A1')
    expect(toA1Form(other.workbook.names.get('qualified')!.formula, other)).toBe('Sheet1!$A$1')
    expect(toA1Form((other.dv.get('cross') as { formula1: string }).formula1, other)).toBe('Sheet1!A1>0')
  })

  it('keeps relocated absolute references when deleting a referenced table column', () => {
    const { sheet, sort } = setup([['Key', 'Drop', 'Formula'], ['3', '30', '=SUM(Data[Drop])+$A$2'], ['2', '20', '=SUM(Data[Drop])+$A$2'], ['1', '10', '=SUM(Data[Drop])+$A$2']])
    sheet.tables.set('table', { name: 'Data', displayName: 'Data', range: sheet.rangeIds(rect(0, 0, 3, 2)), headerRow: true, totalsRow: false, columns: [{ name: 'Key' }, { name: 'Drop' }, { name: 'Formula' }] })
    sort(rect(1, 0, 3, 2))
    commands.deleteLines(sheet, 'col', 1, 1)
    for (const row of [1, 2, 3]) expect(toA1Form(sheet.cell(row, 1)!.f!, sheet)).toBe('SUM(#REF!)+$A$2')
  })

  it('seeds a previously read stationary axis without a stale snapshot', () => {
    const { sheet } = setup([['1'], ['2'], ['3']])
    sheet.workbook.transact(() => sheet.rows.move(0, 1, 2))
    sheet.positionRows.resolve()
    sheet.setRowProp([0], 'size', 42)
    moveAxis(sheet, 'row', 0, 1, 2)
    expect([0, 1, 2].map((r) => sheet.rowProp(r, 'size'))).toEqual([undefined, undefined, 42])
  })

  it('preserves a concurrent unhide on a record during identity sorting', () => {
    const { doc, sheet, sort } = setup([['2'], ['1']])
    commands.setHidden(sheet, 'row', [0], true)
    const id = sheet.rows.idAt(0)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    doc.clientID = 20; peer.clientID = 10
    const other = new WorkbookModel(peer).sheets()[0]!
    sort()
    commands.setHidden(other, 'row', [0], false)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer)); Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    expect(sheet.rowProp(sheet.rows.indexOf(id), 'hidden')).toBeUndefined()
    expect(sheet.rowProp(sheet.rows.indexOf(id), 'manualHidden')).toBeUndefined()
    peer.destroy()
  })

  it.each([false, true])('sorts imported table value filters and refuses opaque kinds; opaque=%s', (opaque) => {
    const { sheet, sort } = setup([['Key'], ['2'], ['1']])
    sheet.tables.set('table', { name: 'Data', displayName: 'Data', range: sheet.rangeIds(rect(0, 0, 2, 0)), headerRow: true, totalsRow: false, columns: [{ name: 'Key' }], xml: `<table name="Data" displayName="Data" ref="A1:A3"><autoFilter ref="A1:A3"><filterColumn colId="0">${opaque ? '<top10/>' : '<filters><filter val="1"/></filters>'}</filterColumn></autoFilter></table>` })
    sheet.setRowProp([1], 'hidden', true)
    if (opaque) expect(() => sort(rect(1, 0, 2, 0))).toThrow(/filter/)
    else {
      sort(rect(1, 0, 2, 0))
      expect([1, 2].map((r) => [sheet.cell(r, 0)?.v, !!sheet.rowProp(r, 'hidden')])).toEqual([[1, false], [2, true]])
      expect(sheet.filter.has('value')).toBe(false)
    }
  })

  it('preserves reference identities authored in a concurrent replacement formula', () => {
    const { doc, sheet, sort } = setup([['3', '=A1'], ['1', '=A2'], ['2', '=A3']])
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const other = new WorkbookModel(peer).sheets()[0]!
    const id = other.rows.idAt(0)
    commands.setCellInput(other, 0, 1, '=$A$1+100')
    const replacement = other.cell(0, 1)!.f
    sort()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer)); Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    expect(sheet.cell(sheet.rows.indexOf(id), 1)!.f).toBe(replacement)
    expect(other.cell(other.rows.indexOf(id), 1)!.f).toBe(replacement)
    peer.destroy()
  })

  it.each([false, true])('keeps outside 3D formulas and metadata positional; partial=%s', (partial) => {
    const { sheet, sort, book, view } = setup([['3'], ['1'], ['2']])
    if (partial) sheet.setCell(0, 2, { v: 'beside' })
    const other = book.addSheet('Other')
    for (const row of [0, 1, 2]) other.setCell(row, 0, { v: (row + 1) * 10 })
    const f = toIdForm('SUM(Sheet1:Other!A1)', other)
    other.setCell(5, 0, { f })
    book.names.set('three', { name: 'Three', scope: other.id, formula: f })
    other.dv.set('three', { ranges: [other.rangeIds(rect(0, 0))], type: 'custom', formula1: f })
    sort(rect(0, 0, 2, 0))
    expect(toA1Form(other.cell(5, 0)!.f!, other)).toBe('SUM(Sheet1:Other!A1)')
    expect(toA1Form(book.names.get('three')!.formula, other)).toBe('SUM(Sheet1:Other!A1)')
    expect(toA1Form((other.dv.get('three') as { formula1: string }).formula1, other)).toBe('SUM(Sheet1:Other!A1)')
    expect(view.values.get(other, 5, 0)).toBe(11)
  })

  it('allows a shared partial-width sort and leaves adjacent content in place', () => {
    const { view, sheet } = setup([['2', 'beside two'], ['1', 'beside one']], true)
    const ids = [sheet.rows.idAt(0), sheet.rows.idAt(1)]
    view.sortArea(rect(0, 0, 1, 0), [{ col: 0 }])
    expect([sheet.rows.idAt(0), sheet.rows.idAt(1)]).toEqual(ids)
    expect([0, 1].map((r) => [view.inputText(r, 0), view.inputText(r, 1)])).toEqual([['1', 'beside two'], ['2', 'beside one']])
  })

  it.each([false, true])('keeps outside relative references attached to their original rows; partial=%s', (partial) => {
    const { sort, sheet } = setup([['3', '=A9', ...(partial ? ['outside'] : [])], ['1', '=A9'], ['2', '=A9']])
    sort(rect(0, 0, 2, 1))
    for (const r of [0, 1, 2]) expect(toA1Form(sheet.cell(r, 1)!.f!, sheet)).toBe('A9')
  })

  it('allows sorting part of a value-filter region and recalculates the full filter', () => {
    const { sort, sheet, display } = setup([['Key'], ['3'], ['1'], ['2']])
    commands.setAutoFilter(sheet, rect(0, 0, 3, 0))
    commands.filterColumn(sheet, 0, ['1'], display)
    sort(rect(1, 0, 2, 0))
    expect([1, 2, 3].map((r) => !!sheet.rowProp(r, 'hidden'))).toEqual([false, true, true])
  })

  it('recalculates a filtered running formula after moving all records', () => {
    const { sheet, sort, display, view } = setup([['Key', 'Previous'], ['3', '=A1'], ['1', '=A2'], ['2', '=A3']])
    commands.setAutoFilter(sheet, rect(0, 0, 3, 1))
    commands.filterColumn(sheet, 1, ['1'], display)
    sort(rect(1, 0, 3, 1))
    expect([1, 2, 3].map((r) => view.displayText(r, 1))).toEqual(['Key', '1', 'Key'])
    expect([1, 2, 3].map((r) => !!sheet.rowProp(r, 'hidden'))).toEqual([true, false, true])
  })

  it.each(['large', 'nested-transaction'] as const)('refuses unsafe preparation contexts without writes: %s', (kind) => {
    const { doc, sort } = setup([['2'], ['1']])
    const before = Y.encodeStateVector(doc)
    if (kind === 'large') expect(() => sort(rect(0, 0, 1000, 1000))).toThrow(/too large/)
    else doc.transact(() => expect(() => sort()).toThrow(/changed/))
    expect(Y.encodeStateVector(doc)).toEqual(before)
  })

  it('aborts if a callback delivers a remote edit while preparing keys', () => {
    const { sheet, view, doc } = setup([['2'], ['1']])
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const remote = new WorkbookModel(peer).sheets()[0]!
    commands.setCellInput(remote, 0, 0, 'remote edit')
    let delivered = false
    expect(() => commands.sortRange(sheet, rect(0, 0, 1, 0), [{ col: 0 }], (r, c) => {
      if (!delivered) { delivered = true; Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer)) }
      return view.valueAt(r, c)
    })).toThrow(/changed/)
    expect(view.inputText(0, 0)).toBe('remote edit')
    expect(view.inputText(1, 0)).toBe('1')
    peer.destroy()
  })
})

it.each(['worksheet-filter', 'plain-sort', 'table-sort'] as const)('exports and imports current sortState XML: %s', async (kind) => {
  const { sheet, doc, sort, assets, display } = setup([['Fruit', 'Qty'], ['apple', '2'], ['pear', '1']])
  if (kind === 'worksheet-filter') {
    commands.setAutoFilter(sheet, rect(0, 0, 2, 1))
    commands.filterColumn(sheet, 0, ['apple'], display)
    // A stale imported nested sort must be replaced.
    const filter = sheet.filter.get('value') as AutoFilter
    sheet.filter.set('value', { ...filter, xml: '<autoFilter ref="A1:B3"><sortState ref="A2:B3"><sortCondition ref="B2:B3"/></sortState><extLst><ext uri="test"/></extLst></autoFilter>' })
  }
  if (kind === 'table-sort') sheet.tables.set('table', { name: 'Data', displayName: 'Data', range: sheet.rangeIds(rect(0, 0, 2, 1)), headerRow: true, totalsRow: false, columns: [{ name: 'Fruit' }, { name: 'Qty' }] } satisfies SheetTable)
  sort(rect(1, 0, 2, 1), [{ col: 0, descending: true }, { col: 1 }], { caseSensitive: true })
  const codec = new SheetCodec()
  const bytes = await codec.exportFile(doc, { name: 'sort.xlsx', assets })
  const pkg = OoxmlPackage.read(bytes)
  const xml = pkg.text(kind === 'table-sort' ? 'xl/tables/table1.xml' : 'xl/worksheets/sheet1.xml')!
  expect(xml.match(/<sortState\b/g)).toHaveLength(1)
  expect(xml).toContain('caseSensitive="1"')
  expect(xml).toMatch(/<sortCondition[^>]*ref="A2:A3"[^>]*descending="1"/)
  expect(xml).toMatch(/<sortCondition[^>]*ref="B2:B3"[^>]*descending="0"/)
  if (kind === 'worksheet-filter') expect(xml.indexOf('<sortState')).toBeLessThan(xml.indexOf('<extLst'))
  const imported = new Y.Doc()
  await codec.importFile(imported, bytes, { name: 'sort.xlsx', assets })
  const target = new WorkbookModel(imported).sheets()[0]!
  if (kind === 'worksheet-filter') {
    expect(target.rowProp(1, 'hidden')).toBe(true)
    expect(target.rowProp(2, 'hidden')).toBeUndefined()
    commands.filterColumn(target, 0, ['apple'], (r, c) => String(target.cell(r, c)?.v ?? ''))
    commands.setAutoFilter(target, undefined)
    expect(target.rowProp(1, 'hidden')).toBeUndefined()
  }
  if (kind === 'table-sort') expect(() => commands.sortRange(target, rect(1, 0, 2, 0), [{ col: 0 }], (r, c) => target.cell(r, c)?.v ?? null)).not.toThrow()
  const applied = new Y.Doc()
  WorkbookModel.initialize(applied).addSheet('Sheet1')
  await codec.applyFile(applied, bytes, { name: 'sort.xlsx', assets })
  const appliedXml = OoxmlPackage.read(await codec.exportFile(applied, { name: 'sort.xlsx', assets })).text(kind === 'table-sort' ? 'xl/tables/table1.xml' : 'xl/worksheets/sheet1.xml')!
  expect(appliedXml).toContain('sortState')
  const roundtrip = OoxmlPackage.read(await codec.exportFile(imported, { name: 'sort.xlsx', assets }))
  const output = roundtrip.text(kind === 'table-sort' ? 'xl/tables/table1.xml' : 'xl/worksheets/sheet1.xml')!
  if (kind !== 'worksheet-filter') expect(output).toContain('sortState')
})

it.each(['import', 'apply', 'restore'] as const)('preserves simultaneous manual and filter hiding through XLSX %s', async (mode) => {
  const { doc, sheet, assets, display } = setup([['Fruit'], ['apple'], ['pear']])
  commands.setHidden(sheet, 'row', [2], true)
  commands.setAutoFilter(sheet, rect(0, 0, 2, 0))
  commands.filterColumn(sheet, 0, ['apple'], display)
  const codec = new SheetCodec()
  const bytes = await codec.exportFile(doc, { name: 'filter.xlsx', assets })
  const incoming = new Y.Doc()
  if (mode === 'import') await codec.importFile(incoming, bytes, { name: 'filter.xlsx', assets })
  else {
    WorkbookModel.initialize(incoming).addSheet('Sheet1')
    await codec.applyFile(incoming, bytes, { name: 'filter.xlsx', assets }, mode === 'restore' ? 'restore' : undefined)
  }
  const target = new WorkbookModel(incoming).sheets()[0]!
  expect(target.rowProp(2, 'manualHidden')).toBe(true)
  commands.setAutoFilter(target, undefined)
  expect(target.rowProp(2, 'hidden')).toBe(true)
  expect(target.rowProp(1, 'hidden')).toBeUndefined()
})

it('replaces a standalone imported sort without duplicating worksheet sortState', async () => {
  const { sheet, sort, doc, assets } = setup([['Fruit', '', '', '3'], ['apple', '', '', '2'], ['pear', '', '', '1']])
  sheet.filter.set('value', { range: sheet.rangeIds(rect(0, 0, 2, 0)), columns: [], sortXml: '<sortState ref="A2:A3"><sortCondition ref="A2:A3"/></sortState>' })
  sort(rect(0, 3, 2, 3), [{ col: 3 }])
  const codec = new SheetCodec()
  const xml = OoxmlPackage.read(await codec.exportFile(doc, { name: 'sort.xlsx', assets })).text('xl/worksheets/sheet1.xml')!
  expect(xml.match(/<sortState\b/g)).toHaveLength(1)
  expect(xml).toContain('ref="D1:D3"')
})

it.each(['plain', 'table', 'cross-sheet'] as const)('relocates sort state on cut/paste: %s', async (kind) => {
  const { sheet, sort, doc, assets, book } = setup([['Fruit', 'Qty'], ['pear', '2'], ['apple', '1']])
  if (kind === 'table') sheet.tables.set('table', { name: 'Data', displayName: 'Data', range: sheet.rangeIds(rect(0, 0, 2, 1)), headerRow: true, totalsRow: false, columns: [{ name: 'Fruit' }, { name: 'Qty' }] } satisfies SheetTable)
  sort(rect(1, 0, 2, 1))
  const target = kind === 'cross-sheet' ? book.addSheet('Target') : sheet
  moveCells(sheet, target, rect(0, 0, 2, 1), { row: 4, col: 3 })
  const pkg = OoxmlPackage.read(await new SheetCodec().exportFile(doc, { name: 'sort.xlsx', assets }))
  const xml = pkg.text(kind === 'table' ? 'xl/tables/table1.xml' : kind === 'cross-sheet' ? 'xl/worksheets/sheet2.xml' : 'xl/worksheets/sheet1.xml')!
  expect(xml).toContain('ref="D6:E7"')
  expect(xml).toContain('ref="D6:D7"')
})

it('refuses a vertical cut of an active filter before changing any cells', () => {
  const { sheet, display, doc } = setup([['Fruit'], ['apple'], ['pear']])
  commands.setAutoFilter(sheet, rect(0, 0, 2, 0))
  commands.filterColumn(sheet, 0, ['apple'], display)
  const before = Y.encodeStateVector(doc)
  expect(() => moveCells(sheet, sheet, rect(0, 0, 2, 0), { row: 4, col: 0 })).toThrow(/Clear filters/)
  expect(Y.encodeStateVector(doc)).toEqual(before)
  commands.setHidden(sheet, 'row', [2], true)
  commands.setAutoFilter(sheet, undefined)
  expect(sheet.rowProp(2, 'hidden')).toBe(true)
})

it.skipIf(process.env.PULPO_SHEETS_FIDELITY !== '1' || !existsSync('/Applications/LibreOffice.app/Contents/MacOS/soffice'))('recalculates sorted same-row formulas through the LibreOffice fidelity oracle', async () => {
  const { doc, assets, sort } = setup([['2', '=A1*10'], ['1', '=A2*10']])
  sort()
  const dir = mkdtempSync(join(tmpdir(), 'pulpo-sort-fidelity-'))
  try {
    const path = join(dir, 'sort.xlsx')
    writeFileSync(path, await new SheetCodec().exportFile(doc, { name: 'sort.xlsx', assets }))
    const results = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { cachedValues, libreOfficeConvert } from './dist/office/sheets/testing/fidelity.js'
      const output = libreOfficeConvert(process.argv[1], 'xlsx', process.argv[2])
      if (!output.ok) throw new Error(output.error)
      console.log(JSON.stringify(cachedValues(output.outputs[0])))
    `, path, join(dir, 'oracle')], { encoding: 'utf8' })) as { cells: { cell: string; cached: unknown }[] }
    expect(results.cells.filter((c) => ['B1', 'B2'].includes(c.cell)).map((c) => c.cached)).toEqual([10, 20])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// This performs a real UNO sort, rather than exporting an already sorted workbook.
it.skipIf(process.env.PULPO_OFFICE_FIDELITY !== '1' && process.env.PULPO_SHEETS_FIDELITY !== '1')('matches the real LibreOffice sort for cross-row formulas, CF/DV, heights and hidden rows', async () => {
  const { doc, sheet, assets, sort } = setup([
    ['Key', 'Same', 'Cross', 'Running', 'Outside', 'Qualified'],
    ['3', '=A2', '=A3', '=SUM(A$2:A2)', '=$A$9', '=Sheet1!A2'],
    ['1', '=A3', '=A4', '=SUM(A$2:A3)', '=$A$9', '=Sheet1!A3'],
    ['2', '=A4', '=A3', '=SUM(A$2:A4)', '=$A$9', '=Sheet1!A4'],
  ])
  sheet.setCell(8, 0, { v: 99 })
  commands.setHidden(sheet, 'row', [1], true)
  sheet.setRowProp([1], 'size', 42)
  sheet.setRowProp([1], 'custom', true)
  commands.setValidation(sheet, [rect(1, 1, 2, 1)], { type: 'whole', formula1: '1', formula2: '10' })
  sheet.cf.set('cf', { ranges: [sheet.rangeIds(rect(1, 0, 2, 0))], rules: [{ type: 'expression', priority: 1, formulas: [toIdForm('A2>1', sheet)] }] })
  const dir = mkdtempSync(join(tmpdir(), 'pulpo-real-sort-'))
  try {
    const codec = new SheetCodec()
    const input = join(dir, 'input.xlsx')
    const oracle = join(dir, 'oracle.xlsx')
    const output = join(dir, 'pulpo.xlsx')
    writeFileSync(input, await codec.exportFile(doc, { name: 'input.xlsx', assets }))
    execFileSync(join(process.env.PULPO_SHEETS_VENV ?? join(homedir(), '.cache/pulpo-sheets-venv'), 'bin/python'), ['-I', join(process.cwd(), 'scripts/sheets/lo_sort.py'), input, oracle, 'A2:F4'], { timeout: 120_000 })
    sort(rect(1, 0, 3, 5))
    writeFileSync(output, await codec.exportFile(doc, { name: 'pulpo.xlsx', assets }))
    const inspect = (path: string): InspectSheet => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `import { inspectXlsx } from './dist/office/sheets/testing/fidelity.js'; console.log(JSON.stringify(inspectXlsx(process.argv[1]).sheets.Sheet1))`, path], { encoding: 'utf8' })) as InspectSheet
    const expected = inspect(oracle)
    const actual = inspect(output)
    for (const col of ['B', 'C', 'D', 'E', 'F']) for (const row of [2, 3, 4]) {
      expect(actual.cells![`${col}${row}`]!.f, `${col}${row}`).toBe(expected.cells![`${col}${row}`]!.f)
    }
    expect(actual.conditionalFormatting?.map((r) => r.ranges)).toEqual(expected.conditionalFormatting?.map((r) => r.ranges))
    expect(actual.dataValidations?.map((r) => r.ranges)).toEqual(expected.dataValidations?.map((r) => r.ranges))
    expect(actual.rows?.['2']?.height).toBe(expected.rows?.['2']?.height)
    expect(actual.rows?.['4']?.hidden).toBe(expected.rows?.['4']?.hidden)
    expect(actual.conditionalFormatting?.[0]?.formulas).toEqual(expected.conditionalFormatting?.[0]?.formulas)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 120_000)
