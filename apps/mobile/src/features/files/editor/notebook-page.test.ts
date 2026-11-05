// @vitest-environment node
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { notebookCodec } from '@pulpo/client-core/office/notebook'
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
  })
})
