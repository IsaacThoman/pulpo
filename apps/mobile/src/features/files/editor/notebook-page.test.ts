// @vitest-environment node
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { cellsMap, notebookCodec } from '@pulpo/client-core/office/notebook'
// @ts-expect-error jsdom ships without type declarations; the test needs only its constructor.
import { JSDOM as UntypedJSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { NOTEBOOK_EDITOR_BUNDLE } from './notebookEditorBundle.generated'
import type { EditorMessage, EditorTheme } from './protocol'

interface PageWindow extends Window {
  close(): void
  pulpoEditor: { receive(message: string): void }
}
const JSDOM = UntypedJSDOM as new (html: string, options: {
  runScripts: 'dangerously'
  beforeParse: (window: PageWindow & typeof globalThis) => void
}) => { window: PageWindow }

const theme: EditorTheme = {
  dark: false, background: '#fff', foreground: '#000', muted: '#eee', mutedForeground: '#666', border: '#ddd',
  primary: '#00f', code: '#eee', codeForeground: '#000', fontSize: 17, bottomPadding: 0,
}

describe('built notebook page', () => {
  it('sanitizes thousands of unknown siblings once and sanitizes their children before unwrapping', async () => {
    const doc = new Y.Doc()
    const assets = new MemoryLiveAssetStore()
    const source = '<x>x</x>'.repeat(6_000) + '<unknown><b onclick="bad()">safe</b><script>bad()</script><a href="javascript:bad()">link</a><unknown><em>nested</em></unknown></unknown>'
    await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify({
      nbformat: 4, nbformat_minor: 5, metadata: {},
      cells: [{ id: 'a', cell_type: 'markdown', source, metadata: {} }],
    })), { name: 'a.ipynb', assets })
    const messages: EditorMessage[] = []
    const dom = new JSDOM(NOTEBOOK_EDITOR_BUNDLE.html, {
      runScripts: 'dangerously',
      beforeParse: (window) => {
        Object.assign(window, {
          webkit: { messageHandlers: { pulpoEditor: { postMessage: (message: string) => messages.push(JSON.parse(message)) } } },
          // jsdom has no viewport; this test renders Markdown without mounting source editors.
          IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
        })
        window.Element.prototype.scrollIntoView = () => {}
      },
    })
    try {
      expect(messages).toContainEqual(expect.objectContaining({ type: 'ready', format: 'notebook' }))
      dom.window.pulpoEditor.receive(JSON.stringify({
        type: 'init', session: 1, update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
        editable: false, placeholder: '', user: { name: 'Ana', color: '#3366ff' }, theme,
      }))
      await expect.poll(() => dom.window.document.querySelector('.markdown')?.textContent).toBe('x'.repeat(6_000) + 'safelinknested\n')
      const content = dom.window.document.querySelector('.markdown')!
      expect(content.querySelectorAll('x, unknown, script, [onclick], [href]')).toHaveLength(0)
      expect(content.querySelector('b')?.textContent).toBe('safe')
      expect(content.querySelector('em')?.textContent).toBe('nested')
      expect(messages.filter((message) => message.type === 'error')).toEqual([])
    } finally {
      dom.window.close()
      doc.destroy()
    }
  }, 20_000)
})


it('refreshes a Markdown image when only its attachment asset changes', async () => {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  const file = (image: string) => new TextEncoder().encode(JSON.stringify({
    nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{
      id: 'a', cell_type: 'markdown', source: '![plot](attachment:plot.png)', metadata: {},
      attachments: { 'plot.png': { 'image/png': image } },
    }],
  }))
  await notebookCodec.importFile(doc, file('AAAA'.repeat(300)), { name: 'a.ipynb', assets })
  let dom!: { window: PageWindow }
  dom = new JSDOM(NOTEBOOK_EDITOR_BUNDLE.html, {
    runScripts: 'dangerously',
    beforeParse: (window) => {
      Object.assign(window, {
        webkit: { messageHandlers: { pulpoEditor: { postMessage: (raw: string) => {
          const message = JSON.parse(raw) as EditorMessage
          if (message.type === 'asset') void assets.get(message.hash).then((bytes) => {
            dom.window.pulpoEditor.receive(JSON.stringify({ type: 'asset', session: message.session, hash: message.hash, data: Buffer.from(bytes).toString('base64') }))
          })
        } } } },
        IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
        requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
      })
      window.Element.prototype.scrollIntoView = () => {}
    },
  })
  try {
    dom.window.pulpoEditor.receive(JSON.stringify({
      type: 'init', session: 1, update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
      editable: false, placeholder: '', user: { name: 'Ana', color: '#3366ff' }, theme,
    }))
    const image = () => dom.window.document.querySelector('.markdown img')?.getAttribute('src')
    await expect.poll(image).toBe(`data:image/png;base64,${'AAAA'.repeat(300)}`)
    const before = cellsMap(doc).values().next().value!.get('attachments')
    const vector = Y.encodeStateVector(doc)
    await notebookCodec.applyFile(doc, file('AQEB'.repeat(300)), { name: 'a.ipynb', assets })
    const after = cellsMap(doc).values().next().value!.get('attachments')
    expect(after.json).toBe(before.json)
    expect(after.assets).not.toEqual(before.assets)
    dom.window.pulpoEditor.receive(JSON.stringify({ type: 'update', session: 1, update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64') }))
    await expect.poll(image).toBe(`data:image/png;base64,${'AQEB'.repeat(300)}`)
  } finally {
    dom.window.close()
    doc.destroy()
  }
})

it.each([['markdown', false], ['output', false], ['markdown', true], ['output', true]] as const)('retries a transient %s image failure while its cell remains (removed: %s)', async (kind, removed) => {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  const imageData = 'AAAA'.repeat(300)
  const cell = kind === 'markdown'
    ? { id: 'a', cell_type: 'markdown', source: '![plot](attachment:plot.png)', metadata: {}, attachments: { 'plot.png': { 'image/png': imageData } } }
    : { id: 'a', cell_type: 'code', source: '', metadata: {}, execution_count: null, outputs: [{ output_type: 'display_data', metadata: {}, data: { 'image/png': imageData } }] }
  await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [cell] })), { name: 'a.ipynb', assets })
  const retries: Array<() => void> = []
  let requests = 0
  let dom!: { window: PageWindow }
  dom = new JSDOM(NOTEBOOK_EDITOR_BUNDLE.html, {
    runScripts: 'dangerously',
    beforeParse: (window) => {
      const setTimeout = window.setTimeout.bind(window)
      window.setTimeout = ((callback: () => void, delay?: number) => {
        if (delay === 15_000) { retries.push(callback); return 0 }
        return setTimeout(callback, delay)
      }) as typeof window.setTimeout
      Object.assign(window, {
        webkit: { messageHandlers: { pulpoEditor: { postMessage: (raw: string) => {
          const message = JSON.parse(raw) as EditorMessage
          if (message.type !== 'asset') return
          const attempt = ++requests
          void assets.get(message.hash).then((bytes) => {
            dom.window.pulpoEditor.receive(JSON.stringify({ type: 'asset', session: message.session, hash: message.hash, data: attempt === 1 ? null : Buffer.from(bytes).toString('base64') }))
          })
        } } } },
        IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
        requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
      })
      window.Element.prototype.scrollIntoView = () => {}
    },
  })
  try {
    dom.window.pulpoEditor.receive(JSON.stringify({ type: 'init', session: 1, update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), editable: false, placeholder: '', user: { name: 'Ana', color: '#3366ff' }, theme }))
    await expect.poll(() => requests).toBe(1)
    await expect.poll(() => retries.length).toBe(1)
    expect(dom.window.document.querySelector('img[src]')).toBeNull()
    const original = dom.window.document.querySelector('[data-cell-key]')
    if (removed) {
      const vector = Y.encodeStateVector(doc)
      cellsMap(doc).clear()
      dom.window.pulpoEditor.receive(JSON.stringify({ type: 'update', session: 1, update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64') }))
      await expect.poll(() => dom.window.document.querySelector('[data-cell-key]')).toBeNull()
      retries.shift()!()
      await Promise.resolve()
      expect(requests).toBe(1)
      expect(dom.window.document.querySelector('img')).toBeNull()
      return
    }
    retries.shift()!()
    await expect.poll(() => dom.window.document.querySelector('img')?.getAttribute('src')).toBe(`data:image/png;base64,${imageData}`)
    expect(requests).toBe(2)
    expect(dom.window.document.querySelector('[data-cell-key]')).toBe(original)
    expect(retries).toHaveLength(0)
  } finally {
    dom.window.close()
    doc.destroy()
  }
})
