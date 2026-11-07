// @vitest-environment node
// @ts-expect-error jsdom ships without type declarations; the test needs only its constructor.
import { JSDOM as UntypedJSDOM } from 'jsdom'
import { afterEach, describe, expect, it } from 'vitest'
import { notebookCodec, orderedCells, cellSourceText } from '@pulpo/client-core/office/notebook'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { NOTEBOOK_EDITOR_BUNDLE } from './notebookEditorBundle.generated'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { EditorBridge } from './bridge'
import { EDITOR_BUNDLE } from './editorBundle.generated'
import type { EditorTheme } from './protocol'
import { TEXT_EDITOR_BUNDLE } from './textEditorBundle.generated'

interface PageWindow extends Window { close(): void }
const JSDOM = UntypedJSDOM as new (html: string, options: {
  runScripts: 'dangerously'
  pretendToBeVisual: boolean
  beforeParse: (window: PageWindow & typeof globalThis) => void
}) => { window: PageWindow }

const theme: EditorTheme = {
  dark: false, background: '#fff', foreground: '#000', muted: '#eee', mutedForeground: '#666', border: '#ddd',
  primary: '#00f', code: '#eee', codeForeground: '#000', fontSize: 17, bottomPadding: 0,
}

/** A built editor page in jsdom, wired to a bridge with asynchronous delivery like the real web view. */
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
        // jsdom has no layout; CodeMirror measures lines and the caret.
        Object.assign(window, { IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} } })
        window.Element.prototype.scrollIntoView = () => {}
        window.document.elementFromPoint = () => null
        const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
        const rect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect
        window.Range.prototype.getClientRects = rects
        window.Range.prototype.getBoundingClientRect = rect
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

  /** The page's CodeMirror view, as `EditorView.findFromDOM` finds it. */
  private get view() {
    type View = { state: { doc: { length: number; toString(): string } }; dispatch(spec: unknown): void }
    return (this.dom.window.document.querySelector('.cm-content') as unknown as { cmTile: { root: { view: View } } }).cmTile.root.view
  }

  /** Types into CodeMirror the way the keyboard does, at the end of the text. */
  type(text: string): void {
    this.view.dispatch({ changes: { from: this.view.state.doc.length, insert: text }, userEvent: 'input.type' })
  }

  get text(): string {
    return this.view.state.doc.toString()
  }

  get window() {
    return this.dom.window as unknown as Window & { pulpoEditorState(): string | null }
  }
}

const pages: Page[] = []
afterEach(() => { for (const page of pages.splice(0)) page.dom.window.close() })

function open(content: string, options: { html?: string; format?: string; schemaVersion?: number } = {}) {
  const doc = new Y.Doc()
  doc.getText('text').insert(0, content)
  const awareness = new Awareness(doc)
  let page!: Page
  const bridge = new EditorBridge({
    doc,
    awareness,
    send: (message) => page.send(message),
    editable: true,
    placeholder: '',
    user: { name: 'Pulpo on iPhone', color: '#123456' },
    theme,
    schemaVersion: options.schemaVersion ?? TEXT_EDITOR_BUNDLE.schemaVersion,
    format: options.format ?? 'text',
    name: 'main.py',
    onError: (message) => { throw new Error(`editor error: ${message}`) },
  })
  page = new Page(bridge, options.html ?? TEXT_EDITOR_BUNDLE.html)
  pages.push(page)
  page.flush()
  return { doc, awareness, bridge, page }
}

describe('text editor bridge with the built editor', () => {
  it('loads the app copy, reports its state, and carries edits both ways', () => {
    const { doc, bridge, page } = open('print("hi")\n')
    expect(bridge.getState()).toMatchObject({ loaded: true, incompatible: false })
    expect(bridge.getState().text).toMatchObject({ language: 'Python', canUndo: false, readOnly: false, lines: 2 })
    expect(page.text).toBe('print("hi")\n')
    page.type('# typed on the phone\n')
    page.flush()
    expect(doc.getText('text').toString()).toBe('print("hi")\n# typed on the phone\n')
    expect(bridge.getState().text?.canUndo).toBe(true)
    // An edit from another device reaches the page.
    doc.getText('text').insert(0, '#!/usr/bin/env python\n')
    page.flush()
    expect(page.text).toBe('#!/usr/bin/env python\nprint("hi")\n# typed on the phone\n')
  })

  it('runs toolbar commands: undo only the phone own typing, indent, and wrap', () => {
    const { doc, bridge, page } = open('a\n')
    page.type('b')
    page.flush()
    doc.getText('text').insert(0, 'remote ')
    page.flush()
    bridge.command('undo')
    page.flush()
    expect(doc.getText('text').toString()).toBe('remote a\n')
    bridge.command('indentMore')
    page.flush()
    expect(doc.getText('text').toString()).toMatch(/^\s+remote a\n/)
    bridge.command('wrap')
    page.flush()
    expect(bridge.getState().text?.wrap).toBe(true)
  })

  it('hands over its whole state when the native host closes it', () => {
    const { page } = open('kept')
    const state = page.window.pulpoEditorState()
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Uint8Array.from(Buffer.from(state!, 'base64')))
    expect(copy.getText('text').toString()).toBe('kept')
  })

  it('refuses a page built for another format', () => {
    const markdownPage = open('x', { html: EDITOR_BUNDLE.html, schemaVersion: EDITOR_BUNDLE.schemaVersion })
    expect(markdownPage.bridge.getState().incompatible).toBe(true)
    const wrongSchema = open('x', { schemaVersion: TEXT_EDITOR_BUNDLE.schemaVersion + 1 })
    expect(wrongSchema.bridge.getState().incompatible).toBe(true)
  })
})


it('keeps the notebook binding alive across typing, toolbar updates, and remote edits', async () => {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify({
    nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ id: 'a', cell_type: 'code', source: 'a', metadata: {}, execution_count: null, outputs: [] }],
  })), { name: 'a.ipynb', assets })
  const awareness = new Awareness(doc)
  let page!: Page
  const bridge = new EditorBridge({
    doc, awareness, send: (message) => page.send(message), editable: true, placeholder: '',
    user: { name: 'Phone', color: '#123456' }, theme,
    schemaVersion: NOTEBOOK_EDITOR_BUNDLE.schemaVersion, format: 'notebook', name: 'a.ipynb',
  })
  page = new Page(bridge, NOTEBOOK_EDITOR_BUNDLE.html)
  pages.push(page)
  const source = () => orderedCells(doc)[0]!.cell.get('source') as Y.Text
  try {
    page.flush()
    bridge.focus('start')
    page.flush()
    await expect.poll(() => page.text).toBe('a')
    page.type('b')
    page.flush()
    expect(cellSourceText(orderedCells(doc)[0]!.cell)).toBe('ab')
    // Updating the Undo toolbar must not re-enter CodeMirror and crash its Yjs plugin.
    await expect.poll(() => { page.flush(); return bridge.getState().notebook?.canUndo }).toBe(true)
    page.type('c')
    page.flush()
    expect(source().toString()).toBe('abc')
    source().insert(0, 'remote ')
    page.flush()
    expect(page.text).toBe('remote abc')
    bridge.command('indentMore')
    page.flush()
    expect(source().toString()).toBe('    remote abc')
  } finally {
    bridge.destroy()
    awareness.destroy()
    doc.destroy()
  }
})
