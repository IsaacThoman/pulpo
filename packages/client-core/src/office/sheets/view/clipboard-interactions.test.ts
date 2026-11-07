// @vitest-environment jsdom
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SheetCodec } from '../codec/codec.js'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { MAX_ROWS, MAX_COLS, type CellRange } from '../address.js'
import { insertAxis } from '../model/structure.js'
import { toA1Form } from '../model/formula-ids.js'
import { WorkbookModel } from '../model/workbook.js'
import type { ConditionalFormat } from '../model/schema.js'
import { SheetView, type SheetViewOptions } from './sheet-view.js'
import { parseHtml, parseTsv, toHtml, toTsv } from './clipboard.js'
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

/** Delivers a separate replica's structural change while the local draft is still open. */
function remote(doc: Y.Doc, change: (book: WorkbookModel) => void) {
  const replica = new Y.Doc()
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
  const vector = Y.encodeStateVector(replica)
  change(new WorkbookModel(replica))
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica, vector), 'remote')
  replica.destroy()
}


const rect = (top: number, left: number, bottom = top, right = left): CellRange => ({ top, left, bottom, right })
function copy(view: SheetView, range: CellRange, cut = false) {
  view.select(range)
  const payload = view.clipboard.copyPayload(cut)!
  expect(payload).toBeDefined()
  return { html: toHtml(payload), text: toTsv(payload.rows) }
}
function paste(view: SheetView, data: { html?: string; text?: string }, range: CellRange, mode = {}) {
  view.select(range)
  view.clipboard.paste(data, mode)
}
function formulas(sheet: ReturnType<typeof setup>['sheet'], inputs: string[][]) {
  inputs.forEach((row, r) => row.forEach((text, c) => commands.setCellInput(sheet, r, c, text)))
}

describe('immutable clipboard snapshots', () => {
  it.each([{}, { values: true }])('preserves filtered source row positions (review A), mode %j', (mode) => {
    const { sheet, view } = setup()
    formulas(sheet, [['10', '=A1'], ['99', '=A2'], ['20', '=A3']])
    sheet.setRowProp([1], 'hidden', true)
    const data = copy(view, rect(0, 1, 2, 1))
    expect(parseHtml(data.html)!.internal!.sourceRows).toEqual([0, 2])
    expect(data.text).toBe('10\n20')
    paste(view, data, rect(9, 1), mode)
    expect([view.inputText(9, 1), view.inputText(10, 1)]).toEqual(mode.values ? ['10', '20'] : ['=A10', '=A11'])
  })

  it.each([1, -1])('captures every result before an overlapping paste-values (review B), direction %s', (direction) => {
    const { sheet, view } = setup()
    formulas(sheet, [['10', '=A1'], ['20', '=A2'], ['30', '=A3']])
    const start = direction > 0 ? 0 : 1, dest = start + direction
    const data = copy(view, rect(start, 1, start + 1, 1))
    paste(view, data, rect(dest, 1), { values: true })
    expect([view.valueAt(dest, 1), view.valueAt(dest + 1, 1)]).toEqual(direction > 0 ? [10, 20] : [20, 30])
  })

  it.each(['copy', 'values', 'formats'] as const)('uses copy-time content after edits and source deletion: %s', (mode) => {
    const { sheet, book, view } = setup()
    formulas(sheet, [['10', '=A1']])
    sheet.setStyle(rect(0, 1), { bold: true, numFmt: '0.00' })
    const data = copy(view, rect(0, 1))
    sheet.setCell(0, 0, { v: 99 })
    sheet.setStyle(rect(0, 1), { bold: false })
    const other = book.addSheet('Other')
    view.setActiveSheet(other.id)
    book.deleteSheet(sheet.id)
    other.setCell(2, 2, { v: 'keep' })
    paste(view, data, rect(2, 2), mode === 'copy' ? {} : { [mode]: true })
    expect(view.inputText(2, 2)).toBe(mode === 'values' ? '10' : mode === 'formats' ? 'keep' : '=B3')
    expect(view.styleAt(2, 2).bold).toBe(mode !== 'values')
  })

  it('detaches nested values, formats and notes returned by copyPayload', () => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 'text', runs: [{ text: 'text', font: { bold: true } }] })
    sheet.setStyle(rect(0, 0), { fill: { rgb: 'FF0000' } })
    sheet.notes.set(sheet.keyAt(0, 0), { text: 'note' })
    const snapshot = view.clipboard.copyPayload()!
    snapshot.internal!.cells[0]![0]!.data!.runs![0]!.text = 'mutated'
    snapshot.internal!.cells[0]![0]!.overrides.fill!.rgb = '000000'
    snapshot.internal!.cells[0]![0]!.note!.text = 'changed'
    expect(sheet.cell(0, 0)!.runs![0]!.text).toBe('text')
    expect(view.styleAt(0, 0).fill).toEqual({ rgb: 'FF0000' })
    expect(sheet.notes.get(sheet.keyAt(0, 0))).toEqual({ text: 'note' })
  })
})

describe('clipboard surface matrix', () => {
  it.each([
    { hidden: 'row', cut: false, expected: '1\t2\t3\n7\t8\t9' },
    { hidden: 'row', cut: true, expected: '1\t2\t3\n4\t5\t6\n7\t8\t9' },
    { hidden: 'col', cut: false, expected: '1\t2\t3\n4\t5\t6\n7\t8\t9' },
  ])('copies hidden/filtered axes: $hidden, cut $cut', ({ hidden, cut, expected }) => {
    const { sheet, view } = setup()
    formulas(sheet, [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']])
    if (hidden === 'row') sheet.setRowProp([1], 'hidden', true)
    else sheet.setColProp([1], 'hidden', true)
    expect(copy(view, rect(0, 0, 2, 2), cut).text).toBe(expected)
  })

  it.each([false, true])('pastes consecutively into hidden destination rows and columns, cut %s', (cut) => {
    const { sheet, view } = setup()
    formulas(sheet, [['1', '2'], ['3', '4']])
    const data = copy(view, rect(0, 0, 1, 1), cut)
    sheet.setRowProp([5], 'hidden', true)
    sheet.setColProp([4], 'hidden', true)
    paste(view, data, rect(4, 3))
    expect(sheet.cell(5, 4)?.v).toBe(4)
  })

  it.each([false, true])('handles overlap and one-step undo, cut %s', (cut) => {
    const { sheet, view } = setup()
    formulas(sheet, [['10', '=A1'], ['20', '=A2'], ['30', '=A3']])
    const data = copy(view, rect(0, 1, 1, 1), cut)
    const before = view.undoManager.undoStack.length
    paste(view, data, rect(1, 1))
    expect([view.inputText(1, 1), view.inputText(2, 1)]).toEqual(cut ? ['=A1', '=A2'] : ['=A2', '=A3'])
    expect(view.inputText(0, 1)).toBe(cut ? '' : '=A1')
    expect(view.undoManager.undoStack.length).toBe(before + 1)
    view.undo()
    expect([0, 1, 2].map((r) => view.inputText(r, 1))).toEqual(['=A1', '=A2', '=A3'])
    view.redo()
    expect(view.inputText(2, 1)).toBe(cut ? '=A2' : '=A3')
  })

  it.each([
    ['=A1+$A$1+A$1+$A1', '=C4+$A$1+C$1+$A4'],
    ["='Other sheet'!A1+Sheet1!$A1", "='Other sheet'!C4+Sheet1!$A4"],
    ['=SUM(A1:B2)', '=SUM(C4:D5)'],
    ['=A1', '=#REF!'],
  ])('translates mixed, absolute, cross-sheet and edge references: %s', (input, expected) => {
    const { sheet, book, view } = setup()
    book.addSheet('Other sheet')
    commands.setCellInput(sheet, 1, 1, input!)
    paste(view, copy(view, rect(1, 1)), input === '=A1' ? rect(0, 0) : rect(4, 3))
    expect(view.inputText(input === '=A1' ? 0 : 4, input === '=A1' ? 0 : 3)).toBe(expected)
  })

  it.each(['html', 'tsv', 'internal'] as const)('tiles smaller ranges and expands smaller selections: %s', (format) => {
    const { sheet, view } = setup()
    formulas(sheet, [['1', '2'], ['3', '4']])
    const original = copy(view, rect(0, 0, 1, 1))
    const data = format === 'internal' ? original : format === 'html' ? { html: '<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>' } : { text: original.text }
    paste(view, data, rect(5, 5, 8, 8))
    expect([5, 6, 7, 8].map((r) => [5, 6, 7, 8].map((c) => view.valueAt(r, c)))).toEqual([[1, 2, 1, 2], [3, 4, 3, 4], [1, 2, 1, 2], [3, 4, 3, 4]])
    paste(view, data, rect(10, 10))
    expect(view.valueAt(11, 11)).toBe(4)
    expect(view.getState().selectionLabel).toBe('K11:L12')
  })

  it.each(['internal', 'html', 'tsv'] as const)('rejects out-of-grid pastes atomically: %s', (format) => {
    const { sheet, view } = setup()
    formulas(sheet, [['1', '2']])
    const data = format === 'internal' ? copy(view, rect(0, 0, 0, 1)) : format === 'html' ? { html: '<table><tr><td>1</td><td>2</td></tr></table>' } : { text: '1\t2' }
    const before = view.undoManager.undoStack.length
    paste(view, data, rect(0, MAX_COLS - 1))
    expect(sheet.cell(0, MAX_COLS - 1)).toBeUndefined()
    expect(view.undoManager.undoStack.length).toBe(before)
    paste(view, { text: '1\n2' }, rect(MAX_ROWS - 1, 0))
    expect(sheet.cell(MAX_ROWS - 1, 0)).toBeUndefined()
  })

  it.each([{}, { values: true }, { formats: true }, { values: true, formats: true }])('preserves merge shapes by paste mode: %j', (mode) => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 'merged' })
    commands.mergeRanges(sheet, [rect(0, 0, 1, 1)], 'all')
    const data = copy(view, rect(0, 0, 1, 1))
    expect(data.html).toContain('rowspan="2"')
    paste(view, data, rect(5, 5), mode)
    expect(sheet.mergedRanges().some((m) => m.range.top === 5)).toBe(!mode.values || !!mode.formats)
    expect(view.inputText(5, 5)).toBe(mode.formats && !mode.values ? '' : 'merged')
  })

  it('preserves external HTML rowspan/colspan and refuses partial merged destinations', () => {
    const { sheet, view } = setup()
    paste(view, { html: '<table><tr><td rowspan="2" colspan="2">merged</td><td>3</td></tr><tr><td>6</td></tr></table>' }, rect(5, 5))
    expect(sheet.mergedRanges()[0]!.range).toEqual(rect(5, 5, 6, 6))
    expect(view.inputText(6, 7)).toBe('6')
    paste(view, { text: 'bad\tbad' }, rect(4, 5, 4, 5))
    expect(view.inputText(5, 5)).toBe('merged')
  })

  it.each([{}, { values: true }, { formats: true }, { values: true, formats: true }])('carries validation, CF, notes and styles per mode, undo as one step: %j', (mode) => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 2 })
    sheet.setCell(5, 5, { v: 9 })
    sheet.setStyle(rect(0, 0), { bold: true })
    commands.setValidation(sheet, [rect(0, 0)], { type: 'custom', formula1: 'A1>0' })
    sheet.cf.set('source', { ranges: [sheet.rangeIds(rect(0, 0))], rules: [{ type: 'expression', priority: 1, formulas: ['A1>1'] }] })
    sheet.notes.set(sheet.keyAt(0, 0), { text: 'copied' })
    const data = copy(view, rect(0, 0))
    sheet.dv.clear(); sheet.cf.clear(); sheet.notes.clear()
    const before = view.undoManager.undoStack.length
    paste(view, data, rect(5, 5), mode)
    const all = !mode.values && !mode.formats || mode.values && mode.formats
    expect(!!commands.validationAt(sheet, 5, 5)).toBe(!!all)
    expect(sheet.cf.size > 0).toBe(!mode.values || !!mode.formats)
    expect(!!sheet.notes.get(sheet.keyAt(5, 5))).toBe(!!all)
    expect(view.styleAt(5, 5).bold).toBe(!mode.values || !!mode.formats)
    if (all) expect(toA1Form(commands.validationAt(sheet, 5, 5)!.formula1!, sheet)).toBe('F6>0')
    if (sheet.cf.size) expect(toA1Form(([...sheet.cf.values()][0] as ConditionalFormat).rules[0]!.formulas![0]!, sheet)).toBe('F6>1')
    expect(view.undoManager.undoStack.length).toBe(before + 1)
    view.undo()
    expect(view.inputText(5, 5)).toBe('9')
    expect(sheet.dv.size).toBe(0)
    expect(sheet.cf.size).toBe(0)
    expect(view.styleAt(5, 5).bold).toBe(false)
  })

  it.each([false, true])('keeps table structured references, cut %s', (cut) => {
    const { sheet, view } = setup()
    formulas(sheet, [['Amount', '=SUM(Sales[Amount])'], ['10', ''], ['20', '']])
    sheet.tables.set('sales', { name: 'Sales', displayName: 'Sales', range: sheet.rangeIds(rect(0, 0, 2, 0)), headerRow: true, totalsRow: false, columns: [{ name: 'Amount' }] })
    const data = copy(view, rect(0, 0, 2, 1), cut)
    paste(view, data, rect(5, 3))
    expect(view.inputText(5, 4)).toBe('=SUM(Sales[Amount])')
    expect(view.valueAt(5, 4)).toBe(30)
    expect(sheet.resolveRange(([...sheet.tables.values()][0] as { range: import('../model/schema.js').RangeIds }).range)).toEqual(cut ? rect(5, 3, 7, 3) : rect(0, 0, 2, 0))
  })

  it.each([{}, { values: true }])('copies dynamic spill anchors and displayed members: %j', (mode) => {
    const { sheet, view } = setup()
    commands.setCellInput(sheet, 0, 0, '=SEQUENCE(2,1,10,10)')
    expect(view.valueAt(1, 0)).toBe(20)
    const data = copy(view, rect(0, 0, 1, 0))
    paste(view, data, rect(5, 5), mode)
    expect([view.valueAt(5, 5), view.valueAt(6, 5)]).toEqual([10, 20])
    expect(!!sheet.cell(5, 5)?.f).toBe(!mode.values)
    paste(view, copy(view, rect(1, 0)), rect(8, 5))
    expect(view.valueAt(8, 5)).toBe(20)
    paste(view, { text: 'obstruction' }, rect(6, 5))
    expect(view.inputText(6, 5)).toBe(mode.values ? 'obstruction' : '')
  })

  it.each([{}, { values: true }])('materializes filtered spill results without spilling extra rows: %j', (mode) => {
    const { sheet, view } = setup()
    commands.setCellInput(sheet, 0, 0, '=SEQUENCE(3)')
    sheet.setRowProp([1], 'hidden', true)
    const data = copy(view, rect(0, 0, 2, 0))
    paste(view, data, rect(5, 5), mode)
    expect([view.valueAt(5, 5), view.valueAt(6, 5), view.valueAt(7, 5)]).toEqual([1, 3, null])
  })

  it.each(['partial-source', 'partial-destination', 'complete'] as const)('guards legacy array formulas: %s', (kind) => {
    const { sheet, view } = setup({ values: 'cached' })
    sheet.setCell(0, 0, { f: 'SEQUENCE(2)', array: { rows: 2, cols: 1 }, v: 10, spillCache: [[10], [20]] })
    const data = copy(view, rect(0, 0, kind === 'partial-source' ? 0 : 1, 0))
    if (kind === 'partial-destination') paste(view, { text: 'bad' }, rect(1, 0))
    else paste(view, data, rect(5, 5))
    if (kind === 'complete') {
      expect(sheet.cell(5, 5)?.array).toEqual({ rows: 2, cols: 1 })
      expect(view.valueAt(6, 5)).toBe(20)
    }
    else expect(sheet.cell(5, 5)).toBeUndefined()
    expect(view.valueAt(1, 0)).toBe(20)
  })

  it.each([false, true])('survives concurrent remote edits and converges without deleting the changed source, cut %s', (cut) => {
    const { sheet, doc, view } = setup()
    formulas(sheet, [['10', '=A1'], ['20', '=A2']])
    const data = copy(view, rect(0, 1, 1, 1), cut)
    const replica = new Y.Doc()
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
    const peer = new WorkbookModel(replica).sheets()[0]!
    peer.setCell(0, 1, { v: 'remote edit' })
    paste(view, data, rect(5, 5), { values: true })
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica), 'remote')
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
    expect(sheet.cell(0, 1)?.v).toBe('remote edit')
    expect([view.valueAt(5, 5), view.valueAt(6, 5)]).toEqual([10, 20])
    expect(peer.cell(5, 5)?.v).toBe(10)
    expect(peer.cell(6, 5)?.v).toBe(20)
    replica.destroy()
  })

  it.each([false, true])('converges when a source edit races with a normal paste, cut %s', (cut) => {
    const { sheet, doc, view } = setup()
    sheet.setCell(0, 0, { v: 'copied' })
    const data = copy(view, rect(0, 0), cut)
    const replica = new Y.Doc()
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
    const peer = new WorkbookModel(replica).sheets()[0]!
    peer.setCell(0, 0, { v: 'remote' })
    paste(view, data, rect(5, 5))
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica), 'remote')
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
    expect(sheet.cell(0, 0)?.v).toBe('remote')
    expect(sheet.cell(5, 5)?.v).toBe('copied')
    expect(peer.cell(0, 0)?.v).toBe('remote')
    expect(peer.cell(5, 5)?.v).toBe('copied')
    view.undo()
    expect(sheet.cell(0, 0)?.v).toBe('remote')
    replica.destroy()
  })

  it.each([false, true])('preserves source inherited formats when copying or moving, cut %s', (cut) => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 10 })
    sheet.setRowProp([0], 'xf', 0)
    sheet.setAxisStyle('row', [0], { bold: true })
    const data = copy(view, rect(0, 0), cut)
    paste(view, data, rect(5, 5))
    expect(view.styleAt(5, 5).bold).toBe(true)
  })

  it('keeps conditional-format statistical domains across copied multi-row ranges', () => {
    const { sheet, view } = setup()
    formulas(sheet, [['10'], ['20'], ['30']])
    sheet.cf.set('scale', { ranges: [sheet.rangeIds(rect(0, 0, 2, 0))], rules: [{ type: 'colorScale', priority: 1, colorScale: { values: [{ type: 'min' }, { type: 'max' }], colors: [{ rgb: 'FFFFFF' }, { rgb: '000000' }] } }] })
    paste(view, copy(view, rect(0, 0, 2, 0)), rect(5, 5))
    expect(view.cellRender(5, 5).overlay?.scaleColor).toBe('#FFFFFF')
    expect(view.cellRender(7, 5).overlay?.scaleColor).toBe('#000000')
    expect(sheet.cf.size).toBe(2)
  })

  it.each(['internal', 'tsv'] as const)('refuses incompatible tiling without writing: %s', (format) => {
    const { sheet, view } = setup()
    formulas(sheet, [['1', '2'], ['3', '4']])
    const data = format === 'internal' ? copy(view, rect(0, 0, 1, 1)) : { text: '1\t2\n3\t4' }
    paste(view, data, rect(5, 5, 7, 7))
    expect(sheet.cell(5, 5)).toBeUndefined()
  })

  it.each(['cell', 'structure'] as const)('preserves edits delivered before cut-paste: %s', (change) => {
    const { sheet, doc, view } = setup()
    sheet.setCell(0, 0, { v: 'copied' })
    const data = copy(view, rect(0, 0), true)
    remote(doc, (book) => change === 'cell' ? book.sheets()[0]!.setCell(0, 0, { v: 'remote' }) : insertAxis(book.sheets()[0]!, 'row', 0, 1))
    paste(view, data, rect(5, 5))
    expect(view.inputText(5, 5)).toBe('copied')
    expect(view.inputText(change === 'cell' ? 0 : 1, 0)).toBe(change === 'cell' ? 'remote' : 'copied')
  })

  it.each(['=1+2', '001', 'line\nbreak', 'tab\there', '"quotes"', 'é 🐙'])('round-trips system HTML/TSV content %j', (text) => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: text, t: 's' })
    const data = copy(view, rect(0, 0))
    expect(parseTsv(data.text)).toEqual([[text]])
    paste(view, data, rect(5, 5))
    expect(view.valueAt(5, 5)).toBe(text)
  })

  it.each(['=literal', "'literal", '001'])('preserves external HTML formula result strings in values mode: %j', (text) => {
    const { view } = setup()
    const html = `<table><tr><td x:str x:fmla='="result"'>${text}</td></tr></table>`
    paste(view, { html }, rect(5, 5), { values: true })
    expect(view.valueAt(5, 5)).toBe(text)
    expect(view.sheet.cell(5, 5)?.f).toBeUndefined()
  })

  it.each(['50%', '1/2/2026', '$10.00'])('external paste-values retains destination formats for %j', (text) => {
    const { view } = setup()
    paste(view, { text }, rect(5, 5), { values: true })
    expect(view.styleAt(5, 5).numFmt).toBe('General')
  })

  it('exports and imports Excel R1C1 HTML formulas when the internal marker is absent', () => {
    const { sheet, view } = setup()
    formulas(sheet, [['10', '=A1+$A$1+A$1+$A1'], ['20', '=A2']])
    sheet.setRowProp([1], 'hidden', true)
    const { html } = copy(view, rect(0, 1))
    expect(html).toContain('x:fmla="=RC[-1]+R1C1+R1C[-1]+RC1"')
    const external = html.replace(/ data-pulpo-sheet="[^"]*"/, '')
    paste(view, { html: external }, rect(5, 5))
    expect(view.inputText(5, 5)).toBe('=E6+$A$1+E$1+$A6')
    paste(view, { html: '<table><tr><td x:fmla="=R[-1]C+RC1">30</td></tr></table>' }, rect(9, 3))
    expect(view.inputText(9, 3)).toBe('=D9+$A10')
  })

  it.each([
    { runs: 'broken' }, { runs: [{ text: 123 }] }, { array: { rows: -1, cols: 'bad' } }, { spillCache: [[{ bad: true }]] }, { f: {} },
  ])('rejects malformed nested snapshot data before writes: %j', (patch) => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 'safe' })
    const payload = view.clipboard.copyPayload()!
    Object.assign(payload.internal!.cells[0]![0]!.data!, patch)
    const html = toHtml(payload)
    expect(parseHtml(html)!.internal).toBeUndefined()
    paste(view, { html }, rect(5, 5))
    expect(view.valueAt(5, 5)).toBe('safe')
  })

  it('ignores malformed or obsolete internal markers and never authorizes an external cut', () => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 'keep' })
    for (const payload of [{ sheet: sheet.id, cells: [] }, { cut: true }, null]) {
      const marker = btoa(JSON.stringify(payload))
      paste(view, { html: `<table data-pulpo-sheet="${marker}"><tr><td>safe</td></tr></table>` }, rect(5, 5))
      expect(view.valueAt(5, 5)).toBe('safe')
    }
    expect(view.inputText(0, 0)).toBe('keep')
  })
})

describe('fill surface matrix', () => {
  it.each([
    { source: rect(0, 0, 1, 0), target: rect(0, 0, 4, 0), inputs: [['1'], ['3']], result: [1, 3, 5, 7, 9] },
    { source: rect(0, 0, 0, 1), target: rect(0, 0, 0, 4), inputs: [['1', '3']], result: [1, 3, 5, 7, 9] },
    { source: rect(2, 0, 3, 0), target: rect(0, 0, 3, 0), inputs: [[''], [''], ['5'], ['7']], result: [1, 3, 5, 7] },
  ])('fills series without changing its source: $source -> $target', ({ source, target, inputs, result }) => {
    const { sheet, view } = setup()
    formulas(sheet, inputs)
    const before = view.undoManager.undoStack.length
    view.clipboard.fill(source, target)
    expect(result.map((_, i) => view.valueAt(target.bottom ? i : 0, target.bottom ? 0 : i))).toEqual(result)
    expect(view.undoManager.undoStack.length).toBe(before + 1)
    view.undo()
    expect(view.valueAt(target.bottom ? target.bottom : 0, target.bottom ? 0 : target.right)).toBe(source.top > 0 ? 7 : null)
  })

  it.each([false, true])('skips hidden/filtered rows and translates formulas, copy %s', (copyMode) => {
    const { sheet, view } = setup()
    formulas(sheet, [['1', '=A1+$A$1'], ['2', 'keep'], ['3', ''], ['4', '']])
    sheet.setRowProp([1], 'hidden', true)
    view.clipboard.fill(rect(0, 1), rect(0, 1, 3, 1), copyMode)
    expect([0, 1, 2, 3].map((r) => view.inputText(r, 1))).toEqual(['=A1+$A$1', 'keep', '=A3+$A$1', '=A4+$A$1'])
  })

  it.each(['filtered-anchor', 'member'] as const)('handles spilled fill patterns safely: %s', (kind) => {
    const { sheet, view } = setup()
    commands.setCellInput(sheet, 0, 0, '=SEQUENCE(3)')
    if (kind === 'filtered-anchor') {
      sheet.setRowProp([1], 'hidden', true)
      const before = view.undoManager.undoStack.length
      view.clipboard.fill(rect(0, 0, 2, 0), rect(0, 0, 5, 0))
      expect(view.undoManager.undoStack.length).toBe(before)
      expect(view.valueAt(5, 0)).toBe(null)
      expect(view.valueAt(7, 0)).toBe(null)
    } else {
      view.clipboard.fill(rect(2, 0), rect(2, 0, 4, 0))
      expect([view.valueAt(3, 0), view.valueAt(4, 0)]).toEqual([3, 3])
    }
  })

  it.each(['merge', 'array', 'edge'] as const)('rejects unsafe fill patterns atomically: %s', (kind) => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 1, ...(kind === 'array' ? { f: 'SEQUENCE(2)', array: { rows: 2, cols: 1 } } : {}) })
    if (kind === 'merge') commands.mergeRanges(sheet, [rect(0, 0, 0, 1)], 'all')
    const before = view.undoManager.undoStack.length
    view.clipboard.fill(rect(0, 0), rect(0, 0, kind === 'edge' ? MAX_ROWS : 3, kind === 'merge' ? 1 : 0))
    expect(view.undoManager.undoStack.length).toBe(before)
    expect(sheet.cell(2, 0)).toBeUndefined()
  })

  it.each([
    { formula: '=SUM(Sales[Jan])', copy: false, expected: ['=SUM(Sales[Feb])', '=SUM(Sales[Mar])'] },
    { formula: '=SUM(Sales[Jan])', copy: true, expected: ['=SUM(Sales[Jan])', '=SUM(Sales[Jan])'] },
    { formula: '=SUM(Sales[[Jan]:[Jan]])', copy: false, expected: ['=SUM(Sales[[Jan]:[Jan]])', '=SUM(Sales[[Jan]:[Jan]])'] },
  ])('fills structured columns with copy and absolute-range semantics: $formula, copy $copy', ({ formula, copy: copyMode, expected }) => {
    const { sheet, view } = setup()
    formulas(sheet, [['Jan', 'Feb', 'Mar'], ['10', '20', '30']])
    sheet.tables.set('sales', { name: 'Sales', displayName: 'Sales', range: sheet.rangeIds(rect(0, 0, 1, 2)), headerRow: true, totalsRow: false, columns: [{ name: 'Jan' }, { name: 'Feb' }, { name: 'Mar' }] })
    commands.setCellInput(sheet, 4, 4, formula)
    view.clipboard.fill(rect(4, 4), rect(4, 4, 4, 6), copyMode)
    expect([view.inputText(4, 5), view.inputText(4, 6)]).toEqual(expected)
  })

  it('captures all fill series before writes and carries inherited formats and validation', () => {
    const { sheet, view } = setup()
    formulas(sheet, [['1', '=A2'], ['3', '=A3']])
    sheet.setColProp([1], 'xf', 0)
    sheet.setStyle(rect(0, 1, 1, 1), { italic: true })
    commands.setValidation(sheet, [rect(0, 1, 1, 1)], { type: 'whole', formula1: '1' })
    view.clipboard.fill(rect(0, 0, 1, 1), rect(0, 0, 3, 1))
    expect(view.inputText(2, 1)).toBe('=A4')
    expect(view.inputText(3, 1)).toBe('=A5')
    expect(view.styleAt(2, 1).italic).toBe(true)
    expect(commands.validationAt(sheet, 2, 1)?.type).toBe('whole')
  })
})

// The oracle recalculates exported results; interactive clipboard semantics are covered above.
it.skipIf(process.env.PULPO_SHEETS_FIDELITY !== '1' || !existsSync('/Applications/LibreOffice.app/Contents/MacOS/soffice'))('recalculates pasted formulas and preserves snapshot values through LibreOffice', async () => {
  const { sheet, view, doc } = setup()
  formulas(sheet, [['10', '=A1'], ['99', '=A2'], ['20', '=A3']])
  sheet.setRowProp([1], 'hidden', true)
  const data = copy(view, rect(0, 1, 2, 1))
  paste(view, data, rect(9, 1))
  sheet.setCell(9, 0, { v: 40 })
  sheet.setCell(10, 0, { v: 50 })
  paste(view, data, rect(0, 3), { values: true })
  const work = mkdtempSync(join(tmpdir(), 'pulpo-clipboard-fidelity-'))
  try {
    const path = join(work, 'clipboard.xlsx')
    const codec = new SheetCodec()
    writeFileSync(path, await codec.exportFile(doc, { name: 'clipboard.xlsx', assets: view.options.assets }))
    // Run the Node-only fidelity tooling outside jsdom (whose import.meta URLs are HTTP).
    const oracle = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { cachedValues, inspectXlsx, libreOfficeConvert } from './dist/office/sheets/testing/fidelity.js'
      const output = libreOfficeConvert(process.argv[1], 'xlsx', process.argv[2])
      if (!output.ok) throw new Error(output.error)
      console.log(JSON.stringify({ results: cachedValues(output.outputs[0]), dump: inspectXlsx(output.outputs[0], { values: true }) }))
    `, path, join(work, 'oracle')], { encoding: 'utf8' })) as { results: { cells: { cell: string; cached: unknown }[] }; dump: { sheets: Record<string, { cells: Record<string, { v: unknown }> }> } }
    expect(oracle.results.cells.find((c) => c.cell === 'B10')?.cached).toBe(40)
    expect(oracle.results.cells.find((c) => c.cell === 'B11')?.cached).toBe(50)
    const dump = oracle.dump
    expect(dump.sheets!.Sheet1!.cells!.D1!.v).toBe(10)
    expect(dump.sheets!.Sheet1!.cells!.D2!.v).toBe(20)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}, 120_000)

it.each(['row', 'col'] as const)('copies stale cuts after inherited %s formats change, preserving the changed source', (axis) => {
  const { sheet, view } = setup()
  sheet.setCell(0, 0, { v: 'source' })
  sheet.setAxisStyle(axis, [0], { bold: true, numFmt: '0.000' })
  const payload = view.clipboard.copyPayload(true)!
  sheet.setAxisStyle(axis, [0], { bold: false, numFmt: '0.00%' })
  view.select({ top: 3, left: 3, bottom: 3, right: 3 })
  view.clipboard.paste({ html: toHtml(payload) }, { formats: true })
  expect(view.styleAt(3, 3)).toMatchObject({ bold: true, numFmt: '0.000' })
  expect(sheet.cell(0, 0)?.v).toBe('source')
  view.select({ top: 4, left: 4, bottom: 4, right: 4 })
  view.clipboard.paste({ html: toHtml(payload) })
  expect(sheet.cell(0, 0)?.v).toBe('source')
  expect(sheet.cell(4, 4)?.v).toBe('source')
  expect(view.styleAt(4, 4).bold).toBe(true)
  expect(view.styleAt(0, 0).bold).toBe(false)
})
