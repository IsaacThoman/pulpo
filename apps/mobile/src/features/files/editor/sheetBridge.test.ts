// @vitest-environment node
import { sheetCodec, WorkbookModel, type SheetModel } from '@pulpo/client-core/office/sheets'
// @ts-expect-error jsdom ships without type declarations; the test needs only its constructor.
import { JSDOM as UntypedJSDOM } from 'jsdom'
import { afterEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { EditorBridge } from './bridge'
import type { EditorTheme, SheetCommand } from './protocol'
import { SHEET_EDITOR_BUNDLE } from './sheetEditorBundle.generated'
import { SHEET_TOOLBAR, sheetToolbarMenu, sheetToolbarState } from './sheetToolbar'
import { TEXT_EDITOR_BUNDLE } from './textEditorBundle.generated'

interface PageWindow extends Window { close(): void; Event: typeof Event; MouseEvent: typeof MouseEvent; KeyboardEvent: typeof KeyboardEvent }
const JSDOM = UntypedJSDOM as new (html: string, options: {
  runScripts: 'dangerously'
  pretendToBeVisual: boolean
  beforeParse: (window: PageWindow & typeof globalThis) => void
}) => { window: PageWindow }

const theme: EditorTheme = {
  dark: false, background: '#fff', foreground: '#000', muted: '#eee', mutedForeground: '#666', border: '#ddd',
  primary: '#00f', code: '#eee', codeForeground: '#000', fontSize: 17, bottomPadding: 0,
}

/** A 2D context that draws nothing: jsdom has no canvas, and the grid only needs text widths back. */
function fakeContext(): CanvasRenderingContext2D {
  const values: Record<string | symbol, unknown> = {
    measureText: (text: string) => ({ width: String(text).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  }
  const inert: object = new Proxy(() => inert, { get: (_target, property) => property === Symbol.toPrimitive ? () => '' : inert })
  return new Proxy(values, {
    get: (target, property) => property in target ? target[property] : () => inert,
    set: (target, property, value) => { target[property] = value; return true },
  }) as unknown as CanvasRenderingContext2D
}

/** The built spreadsheet page in jsdom, wired to a bridge with asynchronous delivery like the real web view. */
class Page {
  readonly dom: { window: PageWindow }
  private readonly toHost: string[] = []
  private readonly toPage: string[] = []

  constructor(private readonly bridge: EditorBridge, html: string) {
    this.dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse: (window) => {
        (window as unknown as { webkit: unknown }).webkit = {
          messageHandlers: { pulpoEditor: { postMessage: (message: string) => this.toHost.push(message) } },
        }
        // jsdom has no layout or canvas.
        window.HTMLCanvasElement.prototype.getContext = (() => fakeContext()) as never
        ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
        window.Element.prototype.scrollIntoView = () => {}
      },
    })
  }

  readonly send = (message: string) => { this.toPage.push(message) }

  flush(): void {
    for (let round = 0; round < 50 && (this.toHost.length || this.toPage.length); round += 1) {
      for (const message of this.toHost.splice(0)) this.bridge.receive(message)
      for (const message of this.toPage.splice(0)) (this.dom.window as unknown as { pulpoEditor: { receive(message: string): void } }).pulpoEditor.receive(message)
    }
  }

  /** Lets the grid's per-frame state reports through. */
  async settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40))
      this.flush()
    }
  }

  element<T extends HTMLElement>(id: string): T {
    return this.dom.window.document.getElementById(id) as T
  }

  /** Types into the formula bar the way the keyboard does. */
  type(text: string): void {
    const input = this.element<HTMLInputElement>('formula')
    input.focus()
    input.value = text
    input.dispatchEvent(new this.dom.window.Event('input', { bubbles: true }))
  }

  press(id: string): void {
    const button = this.element<HTMLElement>(id)
    button.dispatchEvent(new this.dom.window.MouseEvent('click', { bubbles: true }))
  }

  get tabs(): string[] {
    return [...this.dom.window.document.querySelectorAll('#tab-list .tab')].map((tab) => `${tab.textContent}${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}`)
  }

  get window() {
    return this.dom.window as unknown as Window & { pulpoEditorState(): string | null }
  }
}

const pages: Page[] = []
afterEach(() => { for (const page of pages.splice(0)) page.dom.window.close() })

function workbook(fill: (sheet: SheetModel) => void): Y.Doc {
  const doc = new Y.Doc()
  const model = WorkbookModel.initialize(doc)
  fill(model.addSheet('Budget'))
  return doc
}

function sheetOf(doc: Y.Doc, index = 0): SheetModel {
  return new WorkbookModel(doc, 'test').sheets()[index]!
}

async function open(doc: Y.Doc, options: { html?: string; format?: string; editable?: boolean; name?: string } = {}) {
  const awareness = new Awareness(doc)
  let page!: Page
  const bridge = new EditorBridge({
    doc,
    awareness,
    send: (message) => page.send(message),
    editable: options.editable ?? true,
    placeholder: '',
    user: { name: 'Pulpo on iPhone', color: '#123456' },
    theme,
    schemaVersion: SHEET_EDITOR_BUNDLE.schemaVersion,
    format: options.format ?? 'sheet',
    name: options.name ?? 'Budget.xlsx',
    onError: (message) => { throw new Error(`editor error: ${message}`) },
  })
  page = new Page(bridge, options.html ?? SHEET_EDITOR_BUNDLE.html)
  pages.push(page)
  page.flush()
  await page.settle()
  const command = async (name: SheetCommand) => {
    bridge.command(name)
    page.flush()
    await page.settle()
  }
  return { doc, awareness, bridge, page, command }
}

describe('spreadsheet editor bridge with the built editor', () => {
  it('loads the app copy, reports its state, and edits a cell through the formula bar', async () => {
    const doc = workbook((sheet) => {
      sheet.setCell(0, 0, { v: 'Item' })
      sheet.setCell(0, 1, { v: 'Cost' })
      sheet.setCell(1, 0, { v: 'Rent' })
      sheet.setCell(1, 1, { v: 1200 })
    })
    const { bridge, page } = await open(doc)
    expect(bridge.getState()).toMatchObject({ loaded: true, incompatible: false })
    expect(bridge.getState().sheet).toMatchObject({ selection: 'A1', canUndo: false, readOnly: false, valuesOnly: false, frozenRows: 0 })
    expect(page.element<HTMLInputElement>('formula').value).toBe('Item')
    expect(page.tabs).toEqual(['Budget*'])

    page.type('Things')
    await page.settle()
    expect(bridge.getState().sheet?.editing).toBe(true)
    expect(page.element('commit-edit').hidden).toBe(false)
    page.press('commit-edit')
    page.flush()
    await page.settle()
    expect(sheetOf(doc).cell(0, 0)?.v).toBe('Things')
    // Return moves down, as in Excel.
    expect(bridge.getState().sheet).toMatchObject({ selection: 'A2', editing: false, canUndo: true })
    expect(page.element<HTMLInputElement>('formula').value).toBe('Rent')

    // A formula typed in the bar is calculated in the grid.
    page.type('=B2*2')
    page.press('commit-edit')
    page.flush()
    await page.settle()
    expect(sheetOf(doc).cell(1, 0)?.f).toBeDefined()

    // An edit from another device reaches the page: the active cell (A3 now) shows it.
    expect(bridge.getState().sheet?.selection).toBe('A3')
    sheetOf(doc).setCell(2, 0, { v: 'From the web' })
    page.flush()
    await page.settle()
    expect(page.element<HTMLInputElement>('formula').value).toBe('From the web')
  })

  it('runs toolbar commands on the selection and reports which are on', async () => {
    const doc = workbook((sheet) => {
      sheet.setCell(0, 0, { v: 'Name' })
      sheet.setCell(1, 0, { v: 'Charlie' })
      sheet.setCell(2, 0, { v: 'alice' })
      sheet.setCell(3, 0, { v: 'Bob' })
    })
    const { bridge, command } = await open(doc)
    await command('bold')
    await command('alignCenter')
    await command('fillYellow')
    await command('formatPercent')
    expect(sheetToolbarState(bridge.getState()).active).toEqual(expect.arrayContaining(['bold', 'alignCenter', 'fillYellow', 'formatPercent']))
    expect(sheetToolbarState(bridge.getState()).disabled).toEqual(['redo'])
    await command('undo')
    expect(sheetToolbarState(bridge.getState()).active).not.toContain('formatPercent')
    expect(sheetToolbarState(bridge.getState()).disabled).not.toContain('redo')
    await command('redo')
    expect(bridge.getState().sheet?.active).toContain('formatPercent')

    await command('freezeRow')
    expect(bridge.getState().sheet).toMatchObject({ frozenRows: 1 })
    expect(bridge.getState().sheet?.active).toContain('freezeRow')
    await command('freezeRow')
    expect(bridge.getState().sheet?.frozenRows).toBe(0)

    // Sorting from a cell sorts the data around it, keeping the header row.
    await command('sortAscending')
    expect([1, 2, 3].map((row) => sheetOf(doc).cell(row, 0)?.v)).toEqual(['alice', 'Bob', 'Charlie'])
    await command('filter')
    expect(bridge.getState().sheet?.hasFilter).toBe(true)
    await command('filter')
    expect(bridge.getState().sheet?.hasFilter).toBe(false)

    await command('insertRowAbove')
    expect(sheetOf(doc).cell(1, 0)?.v).toBe('Name')
    await command('deleteRow')
    expect(sheetOf(doc).cell(0, 0)?.v).toBe('Name')
    await command('insertColumnRight')
    await command('deleteColumn')
    expect(sheetOf(doc).cell(0, 0)?.v).toBe('Name')
  })

  it('switches and adds sheets from the tabs, finds across sheets, and shares the selection', async () => {
    const doc = workbook((sheet) => sheet.setCell(4, 2, { v: 'needle' }))
    const { awareness, page, bridge, command } = await open(doc)
    page.press('add-sheet')
    page.flush()
    await page.settle()
    expect(page.tabs).toEqual(['Budget', 'Sheet2*'])
    expect(new WorkbookModel(doc, 'test').sheets().map((sheet) => sheet.name)).toEqual(['Budget', 'Sheet2'])

    await command('find')
    expect(page.element('find-bar').hidden).toBe(false)
    const input = page.element<HTMLInputElement>('find-input')
    input.value = 'need'
    input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }))
    page.flush()
    await page.settle()
    expect(page.element('find-count').textContent).toBe('1 of 1')
    expect(page.tabs).toEqual(['Budget*', 'Sheet2'])
    expect(bridge.getState().sheet?.selection).toBe('C5')
    // Other sessions see where this one is.
    expect((awareness.getLocalState() as { sheet?: { sheet?: string } }).sheet?.sheet).toBe(sheetOf(doc).id)
    page.press('find-done')
    expect(page.element('find-bar').hidden).toBe(true)
  })

  it('opens CSV files without formats or more sheets, and read only when not editable', async () => {
    const csv = new Y.Doc()
    await sheetCodec.importFile(csv, new TextEncoder().encode('a,b\n1,2\n'), { name: 'people.csv', assets: { get: () => Promise.reject(new Error('none')), put: () => Promise.reject(new Error('none')) } })
    const { bridge, page } = await open(csv, { name: 'people.csv' })
    expect(bridge.getState().sheet?.valuesOnly).toBe(true)
    expect(sheetToolbarState(bridge.getState()).disabled).toEqual(expect.arrayContaining(['bold', 'fill', 'fillYellow', 'numberFormat', 'wrap']))
    expect(page.element('add-sheet').hidden).toBe(true)

    const readOnly = await open(workbook((sheet) => sheet.setCell(0, 0, { v: 1 })), { editable: false })
    expect(readOnly.bridge.getState().sheet?.readOnly).toBe(true)
    expect(readOnly.page.element<HTMLInputElement>('formula').readOnly).toBe(true)
    readOnly.bridge.setEditable(true)
    readOnly.page.flush()
    await readOnly.page.settle()
    expect(readOnly.bridge.getState().sheet?.readOnly).toBe(false)
  })

  it('hands over its whole state when the native host closes it', async () => {
    const { page } = await open(workbook((sheet) => sheet.setCell(0, 0, { v: 'kept' })))
    page.type('pending last edit')
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Uint8Array.from(Buffer.from(page.window.pulpoEditorState()!, 'base64')))
    expect(sheetOf(copy).cell(0, 0)?.v).toBe('pending last edit')
  })

  it.each(['Enter', 'Escape', 'Tab'])('keeps the formula bar draft open during IME %s', async (key) => {
    const { doc, page, bridge } = await open(workbook((sheet) => sheet.setCell(0, 0, { v: 'kept' })))
    page.type('にほん')
    const input = page.element<HTMLInputElement>('formula')
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = new page.dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...flags })
      input.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      page.flush()
      await page.settle()
      expect(sheetOf(doc).cell(0, 0)?.v).toBe('kept')
      expect(bridge.getState().sheet?.editing).toBe(true)
    }
    page.press('commit-edit')
    page.flush()
    expect(sheetOf(doc).cell(0, 0)?.v).toBe('にほん')
  })

  it('updates CSV mode from the file name at init and after renaming', async () => {
    const csv = new Y.Doc()
    await sheetCodec.importFile(csv, new TextEncoder().encode('a,b\n1,2\n'), { name: 'data.csv', assets: { get: () => Promise.reject(new Error('none')), put: () => Promise.reject(new Error('none')) } })
    const { bridge, page } = await open(csv, { name: 'data.xlsx' })
    expect(bridge.getState().sheet?.valuesOnly).toBe(false)
    expect(page.element('add-sheet').hidden).toBe(false)
    page.type('=1+1')
    page.press('commit-edit')
    page.flush()
    expect(sheetOf(csv).cell(0, 0)?.f).toBeDefined()
    bridge.setName('data.csv')
    page.flush()
    await page.settle()
    expect(bridge.getState().sheet?.valuesOnly).toBe(true)
    expect(page.element('add-sheet').hidden).toBe(true)
    page.type('=2+2')
    page.press('commit-edit')
    page.flush()
    expect(sheetOf(csv).cell(1, 0)).toEqual({ v: '=2+2' })
  })

  it('cancels the draft and disables undo when editability is revoked', async () => {
    const { doc, bridge, page } = await open(workbook((sheet) => sheet.setCell(0, 0, { v: 'kept' })))
    page.type('saved')
    page.press('commit-edit')
    page.flush()
    page.type('pending')
    bridge.setEditable(false)
    page.flush()
    await page.settle()
    bridge.command('undo')
    bridge.command('redo')
    page.flush()
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Uint8Array.from(Buffer.from(page.window.pulpoEditorState()!, 'base64')))
    expect(sheetOf(doc).cell(0, 0)?.v).toBe('saved')
    expect(sheetOf(copy).cell(1, 0)?.v).toBeUndefined()
    expect(bridge.getState().sheet?.editing).toBe(false)
  })

  it('refuses a page built for another format', async () => {
    const wrong = await open(workbook(() => {}), { html: TEXT_EDITOR_BUNDLE.html })
    expect(wrong.bridge.getState().incompatible).toBe(true)
  })

  it('has a menu for every grouped command, and each choice is a page command', () => {
    for (const item of SHEET_TOOLBAR) {
      if (item.options) expect(sheetToolbarMenu(item.command)?.options.length).toBeGreaterThan(1)
      else expect(sheetToolbarMenu(item.command)).toBeNull()
    }
  })
})
