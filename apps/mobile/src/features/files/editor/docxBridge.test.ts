// @vitest-environment node
// @ts-expect-error jsdom ships without type declarations; the test needs only its constructor.
import { JSDOM as UntypedJSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { blankDocx, docxCodec } from '@pulpo/client-core/office/docx'
import { afterEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { EditorBridge } from './bridge'
import { DOCX_EDITOR_BUNDLE } from './docxEditorBundle.generated'
import { docxToolbarCommands } from './docxToolbar'
import { TEXT_EDITOR_BUNDLE } from './textEditorBundle.generated'
import type { EditorTheme } from './protocol'

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
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../../../packages/client-core/fixtures/docx/${name}`, import.meta.url)))

/** The built Word page in jsdom, wired to a bridge with asynchronous delivery like the real web view. */
class Page {
  readonly dom: { window: PageWindow }
  private readonly toHost: string[] = []
  private readonly toPage: string[] = []

  constructor(private readonly bridge: EditorBridge) {
    this.dom = new JSDOM(DOCX_EDITOR_BUNDLE.html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse: (window) => {
        (window as unknown as { webkit: unknown }).webkit = {
          messageHandlers: { pulpoEditor: { postMessage: (message: string) => this.toHost.push(message) } },
        }
        window.Element.prototype.scrollIntoView = () => {}
        window.document.elementFromPoint = () => null
        const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
        const rect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect
        window.Range.prototype.getClientRects = rects
        window.Range.prototype.getBoundingClientRect = rect
        window.Element.prototype.getClientRects = rects
        ;(window.URL as unknown as { createObjectURL(blob: Blob): string }).createObjectURL = () => 'blob:picture'
        ;(window.URL as unknown as { revokeObjectURL(url: string): void }).revokeObjectURL = () => {}
      },
    })
  }

  readonly send = (message: string) => { this.toPage.push(message) }

  async flush(): Promise<void> {
    for (let round = 0; round < 50; round += 1) {
      // Let the page's frames and the app's asset fetches run.
      await new Promise((resolve) => setTimeout(resolve, 20))
      if (!this.toHost.length && !this.toPage.length) return
      for (const message of this.toHost.splice(0)) this.bridge.receive(message)
      for (const message of this.toPage.splice(0)) (this.dom.window as unknown as { pulpoEditor: { receive(message: string): void } }).pulpoEditor.receive(message)
    }
  }

  get document() {
    return this.dom.window.document
  }
}

const pages: Page[] = []
afterEach(() => { for (const page of pages.splice(0)) page.dom.window.close() })

async function open(file: string, options: { schemaVersion?: number; fetchAsset?: (hash: string) => Promise<Uint8Array>; format?: string; editable?: boolean; onLink?: (href: string) => void } = {}) {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  await docxCodec.importFile(doc, fixture(file), { name: file, assets })
  const awareness = new Awareness(doc)
  const fetched: string[] = []
  let page!: Page
  const bridge = new EditorBridge({
    doc,
    awareness,
    send: (message) => page.send(message),
    editable: options.editable ?? true,
    placeholder: '',
    user: { name: 'Pulpo on iPhone', color: '#123456' },
    theme,
    onLink: options.onLink,
    schemaVersion: options.schemaVersion ?? DOCX_EDITOR_BUNDLE.schemaVersion,
    format: options.format ?? 'document',
    name: file,
    fetchAsset: options.fetchAsset ?? (async (hash) => { fetched.push(hash); return assets.get(hash) }),
    onError: (message) => { throw new Error(`editor error: ${message}`) },
  })
  page = new Page(bridge)
  pages.push(page)
  await page.flush()
  return { doc, assets, bridge, page, fetched }
}

const bodyText = (doc: Y.Doc) => docxCodec.toText(doc)

describe('Word editor bridge with the built editor', () => {
  it('loads the app copy, reports its state, and carries edits both ways', async () => {
    const { doc, bridge, page } = await open('basic-formatting.docx')
    expect(bridge.getState()).toMatchObject({ loaded: true, incompatible: false })
    expect(bridge.getState().docx).toMatchObject({ canUndo: false, suggesting: false, layout: 'web' })
    expect(page.document.querySelector('.docx-flow')?.textContent).toContain('Basic formatting')
    // An edit from another device reaches the page.
    const before = page.document.querySelector('.docx-flow')!.querySelectorAll('p').length
    const body = doc.getXmlFragment('body')
    doc.transact(() => {
      const paragraph = new Y.XmlElement('paragraph')
      paragraph.insert(0, [new Y.XmlText('From the laptop')])
      body.insert(0, [paragraph])
    })
    await page.flush()
    expect(page.document.querySelector('.docx-flow')!.querySelectorAll('p').length).toBe(before + 1)
    expect(page.document.querySelector('.docx-flow p')?.textContent).toBe('From the laptop')
  })

  it('runs the phone toolbar: styles, lists, bold, undo, and suggesting', async () => {
    const { doc, bridge, page } = await open('basic-formatting.docx')
    bridge.docxCommand('heading2')
    await page.flush()
    expect(bridge.getState().docx?.styleId).toBe('Heading2')
    expect(bodyText(doc)).toMatch(/^## /)
    bridge.docxCommand('undo')
    await page.flush()
    expect(bridge.getState().docx?.styleId).not.toBe('Heading2')
    bridge.docxCommand('bulletList')
    await page.flush()
    expect(bridge.getState().docx?.list).toBe('bullet')
    bridge.docxCommand('suggest')
    await page.flush()
    expect(bridge.getState().docx?.suggesting).toBe(true)
    bridge.docxCommand('layout')
    await page.flush()
    expect(bridge.getState().docx?.layout).toBe('print')
  })

  it('runs every command on the bar, menus included, without errors', async () => {
    const { bridge, page } = await open('lists.docx')
    const commands = docxToolbarCommands()
    expect(commands).toContain('alignCenter')
    for (const command of commands) {
      bridge.docxCommand(command, command === 'comment' ? 'A note' : command === 'link' ? 'https://example.com' : undefined)
      await page.flush()
    }
    expect(bridge.getState().docx).toMatchObject({ suggesting: true, layout: 'print' })
  })

  it('shows the placeholder only while the document is empty', async () => {
    const doc = new Y.Doc()
    const assets = new MemoryLiveAssetStore()
    await docxCodec.importFile(doc, blankDocx(), { name: 'New.docx', assets })
    const awareness = new Awareness(doc)
    let page!: Page
    const bridge = new EditorBridge({
      doc, awareness, send: (message) => page.send(message), editable: true, placeholder: 'Start writing…',
      user: { name: 'Pulpo on iPhone', color: '#123456' }, theme, schemaVersion: DOCX_EDITOR_BUNDLE.schemaVersion, format: 'document', name: 'New.docx',
      onError: (message) => { throw new Error(`editor error: ${message}`) },
    })
    page = new Page(bridge)
    pages.push(page)
    await page.flush()
    const root = page.document.getElementById('editor')!
    expect(root.classList.contains('docx-empty')).toBe(true)
    expect(root.style.getPropertyValue('--docx-placeholder')).toBe('"Start writing…"')
    doc.transact(() => {
      const paragraph = new Y.XmlElement('paragraph')
      paragraph.insert(0, [new Y.XmlText('Hello')])
      doc.getXmlFragment('body').insert(0, [paragraph])
    })
    await page.flush()
    expect(root.classList.contains('docx-empty')).toBe(false)
  })

  it('opens tapped links through the app and keeps comments out while read-only', async () => {
    const links: string[] = []
    const { doc, bridge, page } = await open('notes-fields.docx', { editable: false, onLink: (href) => links.push(href) })
    const anchor = [...page.document.querySelectorAll('.docx-flow a[href]')].find((element) => element.getAttribute('href') === 'https://example.com/')!
    expect(anchor).toBeTruthy()
    anchor.dispatchEvent(new (page.dom.window as unknown as typeof globalThis).MouseEvent('click', { bubbles: true, cancelable: true }))
    await page.flush()
    expect(links).toEqual(['https://example.com/'])
    const stories = doc.getMap('stories').size
    bridge.docxCommand('comment', 'Not allowed')
    await page.flush()
    expect(doc.getMap('stories').size).toBe(stories)
  })

  it('shows pictures with bytes the app fetches, and refuses malformed requests', async () => {
    const { page, fetched } = await open('objects.docx')
    expect(fetched.length).toBeGreaterThan(0)
    expect(fetched.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true)
    expect([...page.document.querySelectorAll('.docx-flow img[draggable="false"]')].map((image) => image.getAttribute('src'))).toEqual(expect.arrayContaining(['blob:picture']))
    const answers: string[] = []
    const bad = await open('basic-formatting.docx', { fetchAsset: async () => { throw new Error('should not fetch') } })
    const original = bad.bridge['options'].send
    bad.bridge['options'].send = (message: string) => { answers.push(message); original(message) }
    bad.bridge.receive(JSON.stringify({ type: 'asset', session: bad.bridge['session'], requestId: 'x', hash: '../../secrets' }))
    await bad.page.flush()
    expect(answers.map((answer) => JSON.parse(answer))).toContainEqual(expect.objectContaining({ type: 'asset', requestId: 'x', error: 'Unavailable' }))
  })

  it('refuses a page built for another format or schema', async () => {
    const textPage = await open('basic-formatting.docx', { schemaVersion: TEXT_EDITOR_BUNDLE.schemaVersion, format: 'text' })
    expect(textPage.bridge.getState().incompatible).toBe(true)
    const wrongSchema = await open('basic-formatting.docx', { schemaVersion: DOCX_EDITOR_BUNDLE.schemaVersion + 1 })
    expect(wrongSchema.bridge.getState().incompatible).toBe(true)
  })
})
