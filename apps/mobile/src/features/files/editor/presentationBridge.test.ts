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
  return { doc, bridge, page, fetched }
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

  it('opens read only when the document cannot be edited', async () => {
    const { bridge, page } = await open('generated/autoshapes.pptx', false)
    expect(bridge.getState().presentation?.readOnly).toBe(true)
    expect(presentationToolbarState(bridge.getState()).disabled).toContain('undo')
    bridge.setEditable(true)
    await page.flush()
    expect(bridge.getState().presentation?.readOnly).toBe(false)
  })
})
