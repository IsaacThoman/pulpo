// @vitest-environment node
import { applyMarkdownToYDoc, applyNodeToYDoc, mergeMarkdown, ydocToMarkdown, ydocToNode } from '@pulpo/client-core/doc-schema'
// @ts-expect-error jsdom ships without type declarations; the test needs only its constructor.
import { JSDOM as UntypedJSDOM } from 'jsdom'
import { afterEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { EDITOR_ORIGIN, EditorBridge } from './bridge'
import { EDITOR_BUNDLE } from './editorBundle.generated'
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

/** The built editor page in jsdom, wired to a bridge with asynchronous delivery like the real web view. */
class Page {
  readonly dom: { window: PageWindow }
  private readonly toHost: string[] = []
  private readonly toPage: string[] = []

  constructor(private readonly bridge: EditorBridge) {
    this.dom = new JSDOM(EDITOR_BUNDLE.html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse: (window) => {
        (window as unknown as { webkit: unknown }).webkit = {
          messageHandlers: { pulpoEditor: { postMessage: (message: string) => this.toHost.push(message) } },
        }
        // jsdom has no layout; ProseMirror measures for scrolling.
        window.Element.prototype.scrollIntoView = () => {}
        window.document.elementFromPoint = () => null
        window.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
        window.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect
      },
    })
  }

  /** What the bridge sends; delivered on `flush`. */
  readonly send = (message: string) => { this.toPage.push(message) }

  deliverToHost(): void {
    for (const message of this.toHost.splice(0)) this.bridge.receive(message)
  }

  deliverToPage(): void {
    for (const message of this.toPage.splice(0)) (this.dom.window as unknown as { pulpoEditor: { receive(message: string): void } }).pulpoEditor.receive(message)
  }

  /** Delivers queued messages both ways until both sides are quiet. */
  flush(): void {
    for (let round = 0; round < 50 && (this.toHost.length || this.toPage.length); round += 1) {
      this.deliverToHost()
      this.deliverToPage()
    }
  }

  get window() {
    return this.dom.window as unknown as Window & { pulpoEditorState(): string | null }
  }

  close(): void {
    this.dom.window.close()
  }
}

const pages: Page[] = []
afterEach(() => { for (const page of pages.splice(0)) page.close() })

function open(markdown = '', options: Partial<{ schemaVersion: number; editable: boolean }> = {}) {
  const doc = new Y.Doc()
  if (markdown) applyMarkdownToYDoc(doc, markdown)
  const awareness = new Awareness(doc)
  awareness.setLocalStateField('user', { name: 'Pulpo on iPhone', color: '#123456' })
  let page!: Page
  const resolved: number[] = []
  const bridge = new EditorBridge({
    doc,
    awareness,
    send: (message) => page.send(message),
    editable: options.editable ?? true,
    placeholder: 'Start writing…',
    user: { name: 'Pulpo on iPhone', color: '#123456' },
    theme,
    schemaVersion: options.schemaVersion ?? EDITOR_BUNDLE.schemaVersion,
    onResolved: () => resolved.push(Date.now()),
    onError: (message) => { throw new Error(`editor error: ${message}`) },
  })
  page = new Page(bridge)
  pages.push(page)
  page.flush()
  return { doc, awareness, bridge, get page() { return page }, resolved, reload: (beforeLoaded?: () => void) => {
    bridge.reset()
    page.close()
    page = new Page(bridge)
    pages.push(page)
    if (beforeLoaded) {
      // `ready` reaches the app, its `init` reaches the page; the page's `loaded` is still on its way.
      page.deliverToHost()
      page.deliverToPage()
      beforeLoaded()
    }
    page.flush()
    return page
  } }
}

async function exported(bridge: EditorBridge, page: Page): Promise<string> {
  const promise = bridge.exportMarkdown()
  page.flush()
  return (await promise).trim()
}

describe('editor bridge with the built editor', () => {
  it('loads the app copy into the editor and exports it back', async () => {
    const { bridge, page } = open('# Plan\n\n- one\n- two')
    expect(bridge.getState().loaded).toBe(true)
    expect(bridge.getState().formatting?.editable).toBe(true)
    expect(await exported(bridge, page)).toBe('# Plan\n\n- one\n- two')
  })

  it('carries editor commands into the app copy as local edits', () => {
    const { doc, bridge, page } = open('Hello')
    const origins: unknown[] = []
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin))
    bridge.focus('end')
    bridge.format('heading2')
    page.flush()
    expect(ydocToMarkdown(doc).trim()).toBe('## Hello')
    expect(origins).toContain(EDITOR_ORIGIN)
    expect(bridge.getState().formatting?.active).toContain('heading2')
  })

  it('shows remote updates, including ones that arrive before the editor loaded', async () => {
    const { doc, bridge, page, reload } = open('First')
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
    applyMarkdownToYDoc(remote, 'First\n\nSecond from another device')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), 'remote')
    page.flush()
    expect(await exported(bridge, page)).toBe('First\n\nSecond from another device')

    const next = reload(() => {
      applyMarkdownToYDoc(remote, 'First\n\nSecond from another device\n\nThird')
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), 'remote')
    })
    expect(await exported(bridge, next)).toBe('First\n\nSecond from another device\n\nThird')
  })

  it('keeps every edit across a reload and merges the final state pulled from a closing page', async () => {
    const { doc, bridge, reload } = open('Draft')
    let page = reload()
    bridge.focus('end')
    bridge.format('bold')
    page.flush()
    page = reload()
    expect(await exported(bridge, page)).toBe('Draft')
    // An edit the page made but whose message never arrived, as when its view is torn down.
    const lost = page.window.pulpoEditorState
    const editorDoc = new Y.Doc()
    Y.applyUpdate(editorDoc, Y.encodeStateAsUpdate(doc))
    applyMarkdownToYDoc(editorDoc, 'Draft\n\nTyped while closing')
    page.window.pulpoEditorState = () => Buffer.from(Y.encodeStateAsUpdate(editorDoc)).toString('base64')
    bridge.mergeFinalState(page.window.pulpoEditorState())
    page.window.pulpoEditorState = lost
    expect(ydocToMarkdown(doc).trim()).toBe('Draft\n\nTyped while closing')
  })

  it('reviews suggestions through the editor, so its undo covers them', async () => {
    const { doc, bridge, page, resolved } = open('The quick fox.')
    const merged = mergeMarkdown(ydocToNode(doc), 'The quick brown fox.', { mode: 'suggest', changeId: 'change-1' })
    applyNodeToYDoc(doc, merged.doc, 'remote')
    page.flush()
    expect(bridge.getState().suggestions.count).toBe(1)
    bridge.review('next')
    page.flush()
    expect(bridge.getState().suggestions.active).toMatchObject({ changeId: 'change-1', summary: { kind: 'add', inserted: 'brown' } })
    bridge.review('accept')
    page.flush()
    expect(bridge.getState().suggestions.count).toBe(0)
    expect(resolved.length).toBeGreaterThan(0)
    expect(ydocToMarkdown(doc).trim()).toBe('The quick brown fox.')
    bridge.format('undo')
    page.flush()
    expect(bridge.getState().suggestions.count).toBe(1)
    expect(await exported(bridge, page)).toBe('The quick fox.')
  })

  it('shows other sessions\' carets, never its own, and clears its cursor when closed', async () => {
    const { doc, awareness, bridge, page } = open('Hello world')
    // The sync plugin maps the document to Yjs in a timeout after the view mounts.
    await new Promise((resolve) => setTimeout(resolve, 20))
    const text = (doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText
    const at = (index: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index))
    // A peer on the web, and this session's own cursor (set from the editor's reports).
    const peer = new Y.Doc().clientID
    awareness.states.set(peer, { user: { name: 'Safari on macOS', color: '#ff0000' }, cursor: { anchor: at(5), head: at(5) } })
    awareness.meta.set(peer, { clock: 1, lastUpdated: Date.now() })
    awareness.emit('update', [{ added: [peer], updated: [], removed: [] }, 'remote'])
    awareness.setLocalStateField('cursor', { anchor: at(1), head: at(1) })
    page.flush()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const labels = [...page.window.document.querySelectorAll('.collaboration-carets__label')].map((label) => label.textContent)
    expect(labels).toEqual(['Safari on macOS'])
    bridge.destroy()
    expect((awareness.getLocalState() as { cursor?: unknown }).cursor).toBeNull()
  })

  it('refuses a page built for another schema and stays read only when asked', () => {
    const outdated = open('Text', { schemaVersion: EDITOR_BUNDLE.schemaVersion + 1 })
    expect(outdated.bridge.getState()).toMatchObject({ incompatible: true, loaded: false })
    const readOnly = open('Text', { editable: false })
    expect(readOnly.bridge.getState().formatting?.editable).toBe(false)
    readOnly.bridge.format('bold')
    readOnly.page.flush()
    expect(ydocToMarkdown(readOnly.doc).trim()).toBe('Text')
  })
})
