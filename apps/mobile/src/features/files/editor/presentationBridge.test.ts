// @vitest-environment node
// @ts-expect-error jsdom ships without type declarations; the test needs only its constructor.
import { JSDOM as UntypedJSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { presentationCodec, readSnapshot } from '@pulpo/client-core/office/presentation'
import { EditorBridge } from './bridge'
import { PRESENTATION_EDITOR_BUNDLE } from './presentationEditorBundle.generated'
import type { EditorTheme } from './protocol'
import { presentationToolbarState } from './presentationToolbar'

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
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../../../packages/client-core/fixtures/presentation/${name}`, import.meta.url)))

/** The built presentation page in jsdom, wired to a bridge with asynchronous delivery like the real web view. */
class Page {
  readonly dom: { window: PageWindow }
  private readonly toHost: string[] = []
  private readonly toPage: string[] = []

  constructor(private readonly bridge: EditorBridge) {
    this.dom = new JSDOM(PRESENTATION_EDITOR_BUNDLE.html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse: (window) => {
        (window as unknown as { webkit: unknown }).webkit = {
          messageHandlers: { pulpoEditor: { postMessage: (message: string) => this.toHost.push(message) } },
        }
        window.Element.prototype.scrollIntoView = () => {}
        // jsdom has no object URLs; the page only needs a string to put in an image.
        window.URL.createObjectURL = () => `blob:test/${Math.random().toString(36).slice(2)}`
      },
    })
  }

  readonly send = (message: string) => { this.toPage.push(message) }

  /** Delivers messages both ways until both sides are quiet, letting asset fetches settle. */
  async flush(): Promise<void> {
    for (let round = 0; round < 50; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (!this.toHost.length && !this.toPage.length) continue
      for (const message of this.toHost.splice(0)) this.bridge.receive(message)
      for (const message of this.toPage.splice(0)) (this.dom.window as unknown as { pulpoEditor: { receive(message: string): void } }).pulpoEditor.receive(message)
    }
  }

  get window() {
    return this.dom.window as unknown as Window & { pulpoEditorState(): string | null }
  }
}

const pages: Page[] = []
afterEach(() => { for (const page of pages.splice(0)) page.dom.window.close() })

async function open(name: string, editable = true) {
  const assets = new MemoryLiveAssetStore()
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, fixture(name), { name, assets })
  const awareness = new Awareness(doc)
  const fetched: string[] = []
  let page!: Page
  const bridge = new EditorBridge({
    doc,
    awareness,
    send: (message) => page.send(message),
    editable,
    placeholder: '',
    user: { name: 'Pulpo on iPhone', color: '#123456' },
    theme,
    schemaVersion: PRESENTATION_EDITOR_BUNDLE.schemaVersion,
    format: 'presentation',
    name,
    onError: (message) => { throw new Error(`editor error: ${message}`) },
    fetchAsset: async (hash) => {
      fetched.push(hash)
      return assets.get(hash)
    },
  })
  page = new Page(bridge)
  pages.push(page)
  await page.flush()
  return { doc, bridge, page, fetched, awareness }
}

describe('presentation editor bridge with the built page', () => {
  it('loads the deck, reports toolbar state, and fetches pictures through the app', async () => {
    const { bridge, page, fetched } = await open('generated/pictures.pptx')
    expect(bridge.getState()).toMatchObject({ loaded: true, incompatible: false })
    expect(bridge.getState().presentation).toMatchObject({ slideCount: 4, canUndo: false, readOnly: false })
    expect(page.dom.window.document.querySelectorAll('.pp-thumb').length).toBe(4)
    // The page asked the app for the pictures on screen; the app answered from the document's assets.
    expect(fetched.length).toBeGreaterThan(0)
    for (const hash of fetched) expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(presentationToolbarState(bridge.getState()).disabled).toContain('undo')
  })

  it('relays slide and shape presence to the host and clears it when closed', async () => {
    const { doc, bridge, page, awareness } = await open('generated/pictures.pptx')
    expect(awareness.getLocalState()?.presentation).toMatchObject({ slide: readSnapshot(doc).slides[0]!.key, shapes: [] })
    const second = readSnapshot(doc).slides[1]!.key
    const thumb = page.dom.window.document.querySelector<HTMLElement>(`[data-slide="${second}"]`)!
    thumb.dispatchEvent(new (page.window as unknown as typeof globalThis).MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await page.flush()
    expect(awareness.getLocalState()?.presentation).toMatchObject({ slide: second, shapes: [] })
    bridge.command('textBox')
    await page.flush()
    const shape = readSnapshot(doc).slides[1]!.shapes.find((shape) => shape.name?.startsWith('TextBox'))!
    expect(awareness.getLocalState()?.presentation).toMatchObject({ slide: second, shapes: [shape.key] })
    bridge.destroy()
    expect(awareness.getLocalState()?.presentation).toBeNull()
    expect(awareness.getLocalState()?.cursor).toBeNull()
    awareness.destroy()
  })

  it('runs toolbar commands as edits that reach the app, and undoes them', async () => {
    const { doc, bridge, page } = await open('generated/layouts-notes-sections.pptx')
    const before = readSnapshot(doc).slides.length
    bridge.command('newSlide')
    await page.flush()
    expect(readSnapshot(doc).slides.length).toBe(before + 1)
    expect(bridge.getState().presentation).toMatchObject({ canUndo: true, slideCount: before + 1 })
    bridge.command('textBox')
    await page.flush()
    expect(readSnapshot(doc).slides.some((slide) => slide.shapes.some((shape) => shape.name?.startsWith('TextBox')))).toBe(true)
    bridge.command('undo')
    bridge.command('undo')
    await page.flush()
    expect(readSnapshot(doc).slides.length).toBe(before)
  })

  it('shows edits from other devices and hands over its state when closed', async () => {
    const { doc, page } = await open('generated/text-formatting.pptx')
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(copy))
    const state = page.window.pulpoEditorState()
    const replica = new Y.Doc()
    Y.applyUpdate(replica, Uint8Array.from(Buffer.from(state!, 'base64')))
    expect(readSnapshot(replica).slides.length).toBe(readSnapshot(doc).slides.length)
  })

  it('tells the app while the slide show runs, and ends it on request', async () => {
    const { bridge, page } = await open('generated/text-formatting.pptx')
    expect(bridge.getState().presentation?.presenting).toBe(false)
    bridge.command('present')
    await page.flush()
    expect(bridge.getState().presentation?.presenting).toBe(true)
    bridge.command('endShow')
    await page.flush()
    expect(bridge.getState().presentation?.presenting).toBe(false)
  })

  it('opens read only when the document cannot be edited', async () => {
    const { bridge, page } = await open('generated/autoshapes.pptx', false)
    expect(bridge.getState().presentation?.readOnly).toBe(true)
    expect(presentationToolbarState(bridge.getState()).disabled).toContain('undo')
    bridge.setEditable(true)
    await page.flush()
    expect(bridge.getState().presentation?.readOnly).toBe(false)
  })

  it('reviews a proposed deck: changed slides with before and after thumbnails, escaped', async () => {
    const messages: string[] = []
    const dom = new JSDOM(PRESENTATION_EDITOR_BUNDLE.html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse: (window) => {
        (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { pulpoEditor: { postMessage: (message: string) => messages.push(message) } } }
        window.URL.createObjectURL = () => `blob:test/${Math.random().toString(36).slice(2)}`
      },
    })
    const before = fixture('generated/text-formatting.pptx')
    // The proposal changes one slide's text, with markup that must stay text.
    const assets = new MemoryLiveAssetStore()
    const doc = new Y.Doc()
    await presentationCodec.importFile(doc, before, { name: 'deck.pptx', assets })
    const { presentationCommands, plainToText } = await import('@pulpo/client-core/office/presentation')
    const slide = readSnapshot(doc).slides[1]!
    presentationCommands.setShapeText(doc, slide.key, slide.shapes.find((shape) => shape.text)!.key, plainToText('<img src=x onerror=alert(1)> proposed'))
    const after = await presentationCodec.exportFile(doc, { name: 'deck.pptx', assets })
    const window = dom.window as unknown as { pulpoEditor: { receive(message: string): void }; document: Document }
    window.pulpoEditor.receive(JSON.stringify({ type: 'presentationDiff', session: 7, before: Buffer.from(before).toString('base64'), after: Buffer.from(after).toString('base64'), theme }))
    for (let round = 0; round < 100 && !messages.some((message) => message.includes('"loaded"')); round++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(messages.slice(1).join('\n')).toContain('"loaded"')
    const cards = window.document.querySelectorAll('[data-presentation-diff] .pd-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]!.getAttribute('data-status')).toBe('edited')
    expect(cards[0]!.querySelectorAll('.pd-thumb .pp-slide')).toHaveLength(2)
    expect(cards[0]!.querySelector('.pd-added')?.textContent).toContain('proposed')
    expect(window.document.querySelector('img[src="x"]')).toBeNull()
    expect(window.document.getElementById('editor')!.hidden).toBe(true)
    dom.window.close()
  })

  it('reports an error for a version that is not a deck', async () => {
    const messages: string[] = []
    const dom = new JSDOM(PRESENTATION_EDITOR_BUNDLE.html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse: (window) => {
        (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { pulpoEditor: { postMessage: (message: string) => messages.push(message) } } }
      },
    })
    const window = dom.window as unknown as { pulpoEditor: { receive(message: string): void } }
    window.pulpoEditor.receive(JSON.stringify({ type: 'presentationDiff', session: 3, before: Buffer.from('not a zip').toString('base64'), after: Buffer.from('nope').toString('base64'), theme }))
    for (let round = 0; round < 100 && !messages.some((message) => message.includes('"error"')); round++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(messages.some((message) => { const parsed = JSON.parse(message) as { type: string; session?: number }; return parsed.type === 'error' && parsed.session === 3 })).toBe(true)
    dom.window.close()
  })
})
