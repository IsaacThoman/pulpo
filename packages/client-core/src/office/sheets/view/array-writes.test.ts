// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { MAX_ROWS, MAX_COLS, type CellRange } from '../address.js'
import { WorkbookModel } from '../model/workbook.js'
import { SheetView, type SheetViewOptions } from './sheet-view.js'
import { toHtml } from './clipboard.js'
import * as commands from './commands.js'

const views: SheetView[] = []
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup(options: Partial<SheetViewOptions> = {}) {
  const doc = new Y.Doc()
  const book = WorkbookModel.initialize(doc)
  const sheet = book.addSheet('Sheet1')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const view = new SheetView({ container, doc, assets: new MemoryLiveAssetStore(), user: { name: 'Test', color: '#123456' }, ...options })
  view.root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  views.push(view)
  return { doc, book, sheet, view }
}


const rect = (top: number, left: number, bottom = top, right = left): CellRange => ({ top, left, bottom, right })
const whole = rect(1, 1, 3, 3)
const member = rect(2, 2)
type Fixture = ReturnType<typeof setup>
type Path = { name: string; wholeAllowed?: boolean; run: (f: Fixture, full: boolean) => void }
const paths: Path[] = [
  { name: 'typing / formula bar', wholeAllowed: false, run: ({ view }, full) => { view.select(full ? whole : member); view.beginEdit('99'); view.commitEdit() } },
  { name: 'Ctrl+Enter', run: ({ view }, full) => { view.select(full ? whole : member); view.beginEdit('99'); view.commitEdit({ fill: true }) } },
  ...['Delete', 'Backspace'].map((key) => ({ name: key, run: ({ view }: Fixture, full: boolean) => { view.select(full ? whole : member); view.input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) } })),
  ...(['clearContents', 'clearAll'] as const).map((command) => ({ name: command, run: ({ view }: Fixture, full: boolean) => { view.select(full ? whole : member); view[command]() } })),
  { name: 'paste', run: ({ view }, full) => { view.select(full ? whole : member); view.clipboard.paste({ text: full ? '99\t99\t99\n99\t99\t99\n99\t99\t99' : '99' }) } },
  { name: 'paste values', run: ({ view }, full) => { view.select(full ? whole : member); view.clipboard.paste({ text: '99' }, { values: true }) } },
  { name: 'cut source', run: ({ view }, full) => { view.select(full ? whole : member); const data = view.clipboard.copyPayload(true); if (data) { view.select(rect(6, 6)); view.clipboard.paste({ html: toHtml(data) }) } } },
  { name: 'cut destination', run: ({ view }, full) => { view.select(rect(6, 6, full ? 8 : 6, full ? 8 : 6)); const data = view.clipboard.copyPayload(true)!; view.select(full ? whole : member); view.clipboard.paste({ html: toHtml(data) }) } },
  { name: 'fill handle', run: ({ view }, full) => view.clipboard.fill(full ? rect(0, 1, 0, 3) : rect(0, 2), full ? rect(0, 1, 3, 3) : rect(0, 2, 2, 2), true) },
  ...(['d', 'r'] as const).map((key) => ({ name: `Ctrl+${key}`, run: ({ view }: Fixture, full: boolean) => { view.select(full ? key === 'd' ? rect(0, 1, 3, 3) : rect(1, 0, 3, 3) : member); view.input.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })) } })),
  { name: 'replace', run: ({ sheet, view }, full) => { view.replace('3', '99', {}, full ? undefined : { sheetId: sheet.id, row: 2, col: 2 }) } },
  ...(['row', 'col'] as const).flatMap((kind): Path[] => [
    { name: `insert ${kind}`, run: ({ view }, full) => { view.select(full ? whole : member); view.insert(kind, 'before') } },
    { name: `delete ${kind}`, run: ({ view }, full) => { view.select(full ? whole : member); view.deleteLines(kind) } },
  ]),
  { name: 'sort', wholeAllowed: false, run: ({ view }, full) => view.sortArea(full ? whole : rect(2, 2, 3, 2), [{ col: full ? 1 : 2 }]) },
  { name: 'merge', run: ({ view }, full) => { view.select(full ? rect(0, 0, 3, 3) : rect(1, 2, 2, 2)); view.merge() } },
  { name: 'validation list', wholeAllowed: false, run: ({ sheet, view }, full) => {
    const range = full ? whole : member
    if (!sheet.dv.has('list')) sheet.dv.set('list', { ranges: [sheet.rangeIds(range)], type: 'list', formula1: '"99"' })
    view.select(range)
    view.clipboard.openList(range.top, range.left)
    view.root.querySelector<HTMLElement>('[role="option"]')!.click()
  } },
  { name: 'hyperlink display', wholeAllowed: false, run: ({ view }, full) => { view.select(full ? whole : member); view.setLink({ target: 'https://example.com', display: '99' }) } },
]

function fixture(dynamic = false): Fixture {
  const f = setup({ labels: { dataErrors: { ...commands.DATA_ERRORS, partialArray: 'localized array refusal' } } })
  // Cached member cells mirror an imported CSE array; leave C3 unstored to exercise geometry too.
  if (!dynamic) for (let row = 1; row <= 3; row++) for (let col = 1; col <= 3; col++) f.sheet.setCell(row, col, { v: 3 })
  f.sheet.setCell(2, 2, undefined)
  f.sheet.setCell(1, 1, { f: dynamic ? 'SEQUENCE(3,3)' : '{3,3,3;3,3,3;3,3,3}', v: 3, ...(dynamic ? { dynamic: true as const } : { array: { rows: 3, cols: 3 } }) })
  for (let c = 1; c <= 3; c++) f.sheet.setCell(0, c, { v: 99 })
  for (let r = 1; r <= 3; r++) f.sheet.setCell(r, 0, { v: 99 })
  for (let r = 6; r <= 8; r++) for (let c = 6; c <= 8; c++) f.sheet.setCell(r, c, { v: 99 })
  return f
}

describe('shared array guard on interactive writes', () => {
  it.each(paths)('rejects partial legacy arrays atomically: $name', (path) => {
    const f = fixture()
    // Replace needs a stored match; hyperlink needs an empty member. List metadata is prepared
    // before the snapshot so only content-command mutations count toward atomicity.
    if (path.name === 'replace') f.sheet.setCell(2, 2, { v: 3 })
    if (path.name === 'validation list') f.sheet.dv.set('list', { ranges: [f.sheet.rangeIds(member)], type: 'list', formula1: '"99"' })
    const before = Y.encodeStateAsUpdate(f.doc)
    path.run(f, false)
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before)
    expect(f.view.root.querySelector('[role="alert"]')?.textContent).toBe(path.name === 'sort' ? commands.DATA_ERRORS.arrays : 'localized array refusal')
    if (path.name === 'typing / formula bar' || path.name === 'Ctrl+Enter') expect(f.view.editing?.text).toBe('99')
  })

  it.each(paths.filter((p) => p.wholeAllowed !== false))('allows the complete legacy array: $name', (path) => {
    const f = fixture()
    // All actual replacement matches must cover the array, including the anchor formula.
    if (path.name === 'replace') f.sheet.setCell(2, 2, { v: 3 })
    path.run(f, true)
    expect(f.view.root.querySelector('[role="alert"]')).toBeNull()
    if (!path.name.startsWith('insert')) expect(f.sheet.cell(1, 1)?.array).toBeUndefined()
  })

  it.each(paths)('allows dynamic spill member edits (sort stays strict): $name', (path) => {
    const f = fixture(true)
    expect(f.view.valueAt(2, 2)).toBe(5)
    if (path.name === 'replace') f.sheet.setCell(2, 2, { v: 3 })
    path.run(f, false)
    expect(f.view.root.querySelector('[role="alert"]')?.textContent ?? '').toBe(path.name === 'sort' ? commands.DATA_ERRORS.arrays : '')
  })
})

it.each(['typing', 'paste', 'fill', 'link', 'list'] as const)('restores a dynamic spill after clearing a %s obstruction', (path) => {
  const f = fixture(true)
  f.view.select(member)
  if (path === 'typing') { f.view.beginEdit('99'); expect(f.view.commitEdit()).toBe(true) }
  if (path === 'paste') f.view.clipboard.paste({ text: '99' })
  if (path === 'fill') f.view.clipboard.fill(rect(0, 2), rect(0, 2, 2, 2), true)
  if (path === 'link') f.view.setLink({ target: 'https://example.com', display: '99' })
  if (path === 'list') paths.find((p) => p.name === 'validation list')!.run(f, false)
  expect(f.sheet.cell(2, 2)?.v).toBe(path === 'link' ? '99' : 99)
  expect(f.view.valueAt(1, 1)).toEqual({ e: '#SPILL!' })
  // Fill writes two members; clear both to remove every obstruction.
  f.view.select(path === 'fill' ? rect(1, 2, 2, 2) : member)
  f.view.clearContents()
  expect(f.view.valueAt(1, 1)).toBe(1)
  expect(f.view.valueAt(2, 2)).toBe(5)
  expect(f.view.valueAt(3, 3)).toBe(9)
})

it('covers a whole legacy array with disjoint selected ranges', () => {
  const { sheet } = fixture()
  commands.clearContents(sheet, [rect(1, 1, 1, 3), rect(2, 1, 3, 3)])
  expect(sheet.cell(1, 1)).toBeUndefined()
})

it('preflights Replace All across sheets before changing any match', () => {
  const f = fixture()
  const other = f.book.addSheet('Other')
  other.setCell(0, 0, { v: 3 })
  const before = Y.encodeStateAsUpdate(f.doc)
  expect(f.view.replace('3', '99', { allSheets: true })).toBe(0)
  expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before)
})

it('permits formatting an array member without changing its content', () => {
  const f = fixture()
  f.view.select(member)
  f.view.setStyle({ bold: true })
  f.view.clearFormats()
  f.view.clipboard.paste({ text: '99' }, { formats: true })
  expect(f.sheet.cell(1, 1)?.array).toEqual({ rows: 3, cols: 3 })
  expect(f.view.root.querySelector('[role="alert"]')).toBeNull()
})

it.each(['d', 'r'])('preflights all Ctrl+%s selections before the first write', (key) => {
  const f = fixture()
  f.view.select(rect(5, 5, 6, 6))
  f.view.select(member, { add: true })
  const before = Y.encodeStateAsUpdate(f.doc)
  f.view.input.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }))
  expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before)
  expect(f.view.root.querySelector('[role="alert"]')?.textContent).toBe('localized array refusal')
})

it('moves a complete legacy array to an overlapping destination', () => {
  const f = fixture()
  f.view.select(whole)
  const data = f.view.clipboard.copyPayload(true)!
  f.view.select(rect(2, 1))
  f.view.clipboard.paste({ html: toHtml(data) })
  expect(f.sheet.cell(1, 1)).toBeUndefined()
  expect(f.sheet.cell(2, 1)?.array).toEqual({ rows: 3, cols: 3 })
  expect(f.view.root.querySelector('[role="alert"]')).toBeNull()
})

it('allows replacing a one-cell legacy array', () => {
  const { sheet, view } = setup()
  sheet.setCell(0, 0, { f: 'SUM(1,2)', array: { rows: 1, cols: 1 } })
  view.select(rect(0, 0))
  view.beginEdit('99')
  expect(view.commitEdit()).toBe(true)
  expect(sheet.cell(0, 0)?.v).toBe(99)
})


it.each(paths.filter((p) => p.wholeAllowed === false && p.name !== 'hyperlink display'))('keeps the full selection safe when the operation only writes its active cell or forbids array moves: $name', (path) => {
  const f = fixture()
  path.run(f, true)
  expect(f.sheet.cell(1, 1)?.array).toEqual({ rows: 3, cols: 3 })
  expect(f.view.root.querySelector('[role="alert"]')?.textContent).toBe(path.name === 'sort' ? commands.DATA_ERRORS.arrays : 'localized array refusal')
})

it.each(['row', 'col'] as const)('allows inserting %s lines immediately after a legacy array', (kind) => {
  const f = fixture()
  f.view.select(whole)
  f.view.insert(kind, 'after')
  expect(f.sheet.cell(1, 1)?.array).toEqual({ rows: 3, cols: 3 })
  expect(f.view.root.querySelector('[role="alert"]')).toBeNull()
})

it('protects oversized imported legacy arrays without expanding their members', () => {
  const { sheet, view } = setup()
  sheet.setCell(0, 0, { f: '1', array: { rows: MAX_ROWS, cols: MAX_COLS }, oversizedArray: true })
  view.select(rect(MAX_ROWS - 1, MAX_COLS - 1))
  view.clearContents()
  expect(sheet.cell(0, 0)?.array).toBeDefined()
  expect(view.root.querySelector('[role="alert"]')?.textContent).toBe(commands.DATA_ERRORS.partialArray)
  commands.clearContents(sheet, [rect(0, 0, MAX_ROWS - 1, MAX_COLS - 1)])
  expect(sheet.cell(0, 0)).toBeUndefined()
})
