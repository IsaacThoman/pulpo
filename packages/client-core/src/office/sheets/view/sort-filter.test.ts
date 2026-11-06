// @vitest-environment jsdom
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { MemoryLiveAssetStore } from '../../assets.js'
import { OoxmlPackage } from '../../ooxml/package.js'
import { SheetCodec } from '../codec/codec.js'
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

  it.each(['outside-key', 'empty-keys', 'partial-filter', 'multiple-tables', 'table-plus-outside'] as const)('refuses ambiguous boundaries atomically: %s', (kind) => {
    const { doc, sheet, sort } = setup([['3', 'x'], ['2', 'y'], ['1', 'z']])
    if (kind === 'partial-filter') commands.setAutoFilter(sheet, rect(0, 0, 2, 1))
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

  it.each(['=A1', '=Sheet1!A2', '=SUM(A1:A2)', '=SUM(A:A)'])('refuses unverified formula relocation: %s', (formula) => {
    const { sort, doc } = setup([['2', '=A1'], ['1', formula]])
    const before = Y.encodeStateVector(doc)
    expect(() => sort()).toThrow(/references/)
    expect(Y.encodeStateVector(doc)).toEqual(before)
  })

  it.each(['merge', 'manual-hide', 'outline', 'validation', 'conditional-format', 'row-style', 'drawing', 'range-hyperlink', 'filtered-formula'] as const)('refuses unsafe metadata without writes: %s', (kind) => {
    const { sheet, doc, sort, display } = setup([['3', 'a'], ['2', 'b'], ['1', 'c']])
    const area = rect(0, 0, 2, 1)
    if (kind === 'merge') commands.mergeRanges(sheet, [rect(1, 0, 1, 1)])
    if (kind === 'manual-hide') commands.setHidden(sheet, 'row', [1], true)
    if (kind === 'outline') sheet.setRowProp([1], 'level', 1)
    if (kind === 'validation') commands.setValidation(sheet, [area], { type: 'whole', formula1: '1' })
    if (kind === 'conditional-format') sheet.cf.set('cf', { ranges: [sheet.rangeIds(area)], rules: [] })
    if (kind === 'row-style') sheet.setAxisStyle('row', [1], { bold: true })
    if (kind === 'drawing') sheet.drawings.set('image', {})
    if (kind === 'range-hyperlink') sheet.links.set(sheet.keyAt(0, 0), { target: 'https://example.com', range: sheet.rangeIds(area) })
    if (kind === 'filtered-formula') {
      commands.setAutoFilter(sheet, rect(0, 0, 2, 1))
      commands.filterColumn(sheet, 0, ['2'], display)
      commands.setCellInput(sheet, 2, 1, '=A3')
    }
    const before = Y.encodeStateVector(doc)
    expect(() => sort(kind === 'filtered-formula' ? rect(1, 0, 2, 1) : area)).toThrow(commands.DataOperationError)
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
    expect(() => sort(rect(kind === 'anchor' ? 0 : 1, 0, 2, 1))).toThrow(/references/)
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

  it.each(['sort', 'filter-menu'] as const)('refuses shared-document sorts while concurrent edits survive: %s', (entry) => {
    const { view, doc, column } = setup([['Fruit'], ['pear'], ['apple']], true)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const remote = new WorkbookModel(peer).sheets()[0]!
    commands.setCellInput(remote, 1, 0, 'remote pear')
    const before = Y.encodeStateVector(doc)
    if (entry === 'sort') { view.select(rect(0, 0, 2, 0)); view.sort(false) }
    else view.sortArea(rect(1, 0, 2, 0), [{ col: 0 }])
    expect(view.root.querySelector('[role="alert"]')?.textContent).toMatch(/exclusive editing lock/)
    expect(Y.encodeStateVector(doc)).toEqual(before)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer))
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    expect(column()).toEqual(['Fruit', 'remote pear', 'apple'])
    expect(remote.cell(1, 0)?.v).toBe('remote pear')
    peer.destroy()
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
