// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { insertAxis, deleteAxis } from '../model/structure.js'
import { WorkbookModel } from '../model/workbook.js'
import { SheetView, type SheetViewOptions } from './sheet-view.js'

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

function validation(sheet: ReturnType<typeof setup>['sheet']) {
  sheet.dv.set('test', { ranges: [sheet.rangeIds({ top: 0, left: 0, bottom: 0, right: 0 })], type: 'whole', operator: 'between', formula1: '1', formula2: '10', showErrorMessage: true })
}

describe('pending spreadsheet edits', () => {
  it.each(['row', 'col'] as const)('follows stable %s ids through remote insertions', (axis) => {
    const { doc, sheet, view } = setup()
    sheet.setCell(0, 0, { v: 'keep' })
    sheet.setCell(1, 1, { v: 'original' })
    view.select({ top: 1, left: 1, bottom: 1, right: 1 })
    view.beginEdit('edited')
    remote(doc, (book) => insertAxis(book.sheets()[0]!, axis, 0, 1))
    expect(view.commitEdit()).toBe(true)
    expect(sheet.cell(axis === 'row' ? 2 : 1, axis === 'col' ? 2 : 1)?.v).toBe('edited')
    expect(sheet.cell(axis === 'row' ? 1 : 0, axis === 'col' ? 1 : 0)?.v).toBe('keep')
  })

  it.each(['row', 'col'] as const)('cancels a draft whose %s was deleted remotely', (axis) => {
    const { doc, sheet, view } = setup()
    sheet.setCell(1, 1, { v: 'keep' })
    view.beginEdit('deleted draft')
    remote(doc, (book) => deleteAxis(book.sheets()[0]!, axis, 0, 1))
    view.commitEdit()
    expect(view.editing).toBeUndefined()
    expect(sheet.cell(axis === 'row' ? 0 : 1, axis === 'col' ? 0 : 1)?.v).toBe('keep')
  })

  it('resolves fill ranges and their formula anchor by id', () => {
    const { doc, sheet, view } = setup()
    sheet.setCell(0, 0, { v: 'keep' })
    view.select({ top: 1, left: 1, bottom: 2, right: 2 })
    view.beginEdit('=A2')
    remote(doc, (book) => {
      insertAxis(book.sheets()[0]!, 'row', 0, 1)
      insertAxis(book.sheets()[0]!, 'col', 0, 1)
    })
    view.commitEdit({ fill: true })
    expect(view.inputText(2, 2)).toBe('=A2')
    expect(view.inputText(3, 3)).toBe('=B3')
    expect(sheet.cell(1, 1)?.v).toBe('keep')
    expect(sheet.cell(1, 2)).toBeUndefined()
  })

  it('commits on the original sheet before switching tabs or deleting it', () => {
    const { sheet, book, view } = setup()
    const other = book.addSheet('Other')
    other.setCell(0, 0, { v: 'keep' })
    view.beginEdit('original sheet')
    view.setActiveSheet(other.id)
    expect(sheet.cell(0, 0)?.v).toBe('original sheet')
    expect(other.cell(0, 0)?.v).toBe('keep')
    view.setActiveSheet(sheet.id)
    view.beginEdit('before delete')
    view.deleteSheet(sheet.id)
    view.commitEdit()
    expect(other.cell(0, 0)?.v).toBe('keep')
  })

  it('cancels when the owning sheet is deleted remotely', () => {
    const { doc, sheet, book, view } = setup()
    const other = book.addSheet('Other')
    other.setCell(0, 0, { v: 'keep' })
    view.beginEdit('deleted draft')
    remote(doc, (book) => book.deleteSheet(sheet.id))
    view.commitEdit()
    expect(view.sheetId).toBe(other.id)
    expect(other.cell(0, 0)?.v).toBe('keep')
  })

  it('stays on the current sheet when validation rejects a switch or deletion', () => {
    const { sheet, book, view } = setup()
    const other = book.addSheet('Other')
    other.setCell(0, 0, { v: 'keep' })
    validation(sheet)
    view.beginEdit('invalid')
    view.setActiveSheet(other.id)
    expect(view.sheetId).toBe(sheet.id)
    view.deleteSheet(sheet.id)
    expect(book.sheet(sheet.id)).toBeDefined()
    expect(view.commitEdit()).toBe(false)
    expect(other.cell(0, 0)?.v).toBe('keep')
  })

  it('settles before teardown, cancelling rejected drafts', () => {
    const { sheet, view } = setup()
    view.beginEdit('last typed cell')
    view.destroy()
    expect(sheet.cell(0, 0)?.v).toBe('last typed cell')
    const invalid = setup()
    validation(invalid.sheet)
    invalid.view.beginEdit('invalid')
    expect(invalid.view.settleEdit()).toBe(false)
    expect(invalid.view.editing).toBeUndefined()
    expect(invalid.sheet.cell(0, 0)).toBeUndefined()
  })

  it('cancels drafts and blocks every command after becoming read only', async () => {
    const { doc, sheet, view } = setup()
    view.beginEdit('saved')
    view.commitEdit()
    view.undo()
    view.redo()
    view.beginEdit('pending')
    view.readOnly = true
    expect(view.editing).toBeUndefined()
    const before = Y.encodeStateAsUpdate(doc)
    view.commitEdit({ fill: true })
    view.undo()
    view.redo()
    view.clipboard.paste({ text: 'paste' })
    view.clipboard.fill({ top: 0, left: 0, bottom: 0, right: 0 }, { top: 0, left: 0, bottom: 1, right: 0 })
    view.clearContents()
    view.setStyle({ bold: true })
    view.insert('row', 'before')
    view.deleteLines('col')
    view.renameSheet(sheet.id, 'Changed')
    view.deleteSheet(sheet.id)
    view.addSheet()
    view.duplicateSheet(sheet.id)
    view.replace('saved', 'replacement')
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    expect(sheet.cell(0, 0)?.v).toBe('saved')
  })

  it('rechecks read only after an image upload completes', async () => {
    const assets = new MemoryLiveAssetStore()
    let release!: () => void
    const upload = vi.spyOn(assets, 'put').mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { hash: 'image', sizeBytes: 1, mimeType: 'image/png' }
    })
    const { sheet, view } = setup({ assets })
    const pending = view.insertImage(new Uint8Array([1]), 'image/png', { width: 10, height: 10 })
    view.readOnly = true
    release()
    await pending
    expect(upload).toHaveBeenCalledOnce()
    expect(sheet.drawings.size).toBe(0)
  })

  it('uses the current file format for formulas after renaming in either direction', () => {
    const { book, sheet, view } = setup({ fileFormat: 'xlsx' })
    book.setMeta('format', 'csv')
    expect(view.valuesOnly).toBe(false)
    view.beginEdit('=1+1')
    view.commitEdit()
    expect(sheet.cell(0, 0)?.f).toBeDefined()
    view.setFileFormat('csv')
    expect(view.getState().valuesOnly).toBe(true)
    view.beginEdit('=2+2')
    view.commitEdit()
    expect(sheet.cell(0, 0)).toEqual({ v: '=2+2' })
  })

  it.each(['Enter', 'Escape', 'Tab'])('ignores grid %s during IME composition and key code 229', (key) => {
    const { sheet, view } = setup()
    view.beginEdit('にほん')
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...flags })
      view.input.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(view.editing?.text).toBe('にほん')
      expect(sheet.cell(0, 0)).toBeUndefined()
    }
  })
})

const drawing = { anchor: 'absolute' as const, pos: { x: 0, y: 0 }, ext: { cx: 200 * 9525, cy: 100 * 9525 }, z: 0 }

it('refreshes chart output for values and themes while keeping its XML cached', async () => {
  const renderChart = vi.fn((_xml, _size, _theme, resolve) => `<svg><text>${resolve('Sheet1!A1')?.[0]?.[0]}</text></svg>`)
  const assets = new MemoryLiveAssetStore()
  const part = await assets.put(new TextEncoder().encode('<chart/>'), 'application/xml')
  const get = vi.spyOn(assets, 'get')
  const { book, sheet, view } = setup({ assets, renderChart })
  book.parts.set('chart.xml', { ...part, mimeType: 'application/xml' })
  sheet.setCell(0, 0, { v: 1 })
  sheet.drawings.set('chart', { ...drawing, kind: 'chart', chart: 'chart.xml' })
  view.resize()
  await vi.waitFor(() => expect(renderChart).toHaveBeenCalled())
  const before = renderChart.mock.calls.length
  sheet.setCell(0, 0, { v: 2 })
  view.renderNow()
  expect(renderChart.mock.calls.length).toBeGreaterThan(before)
  expect(view.overlay.textContent).toBe('2')
  const after = renderChart.mock.calls.length
  view.renderNow()
  expect(renderChart).toHaveBeenCalledTimes(after)
  view.options.appearance = 'dark'
  view.renderNow()
  expect(renderChart).toHaveBeenCalledTimes(after + 1)
  book.setMeta('themeXml', '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>')
  view.renderNow()
  expect(get).toHaveBeenCalledOnce()
})

it.each([false, true])('deduplicates image loads and cleans up when destroyed before resolution: %s', async (destroyEarly) => {
  let release!: (bytes: Uint8Array) => void
  const assets = new MemoryLiveAssetStore()
  const get = vi.spyOn(assets, 'get').mockImplementation(() => new Promise((resolve) => { release = resolve }))
  const create = vi.fn(() => 'blob:test')
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const { sheet, view } = setup({ assets })
  for (const id of ['one', 'two']) sheet.drawings.set(id, { ...drawing, kind: 'image', image: { hash: 'same', mimeType: 'image/png' } })
  view.resize()
  expect(get).toHaveBeenCalledOnce()
  if (destroyEarly) view.destroy()
  release(new Uint8Array([1]))
  await vi.waitFor(() => {
    if (destroyEarly) expect(create).not.toHaveBeenCalled()
    else expect(view.overlay.querySelectorAll('img[src="blob:test"]')).toHaveLength(2)
  })
  // Flush every continuation before checking that late loads allocated nothing.
  await new Promise((resolve) => setTimeout(resolve, 0))
  view.destroy()
  expect(create).toHaveBeenCalledTimes(destroyEarly ? 0 : 1)
  expect(revoke).toHaveBeenCalledTimes(destroyEarly ? 0 : 1)
})
