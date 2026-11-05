// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { SocketIOYProvider } from '@pulpo/client-core/doc-sync'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { notebookCodec } from '@pulpo/client-core/office/notebook'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { NotebookDocEditor } from './NotebookDocEditor'

// jsdom has no layout or scrolling.
beforeAll(() => { Element.prototype.scrollIntoView = () => {} })
afterEach(cleanup)

describe('notebook output frames', () => {
  it.each(['text/html', 'application/javascript'])('remounts a replaced %s output at the same index', async (mime) => {
    const doc = new Y.Doc()
    const assets = new MemoryLiveAssetStore()
    const provider = new SocketIOYProvider('notebook', doc)
    const output = (value: string) => ({ output_type: 'display_data', metadata: {}, data: { [mime]: value } })
    await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify({
      nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{
        id: 'a', cell_type: 'code', source: '', execution_count: null,
        metadata: { jupyter: { source_hidden: true } }, outputs: [output('old content')],
      }],
    })), { name: 'a.ipynb', assets })
    const view = render(<NotebookDocEditor session={{ doc, provider }} name="a.ipynb" editable={false} width="fill" assets={assets} />)
    try {
      await waitFor(() => expect(view.container.querySelector('iframe')).toBeTruthy())
      const original = view.container.querySelector('iframe')!
      // Finish the initial sandbox render before replacing it, reproducing the stale-frame case.
      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', { source: original.contentWindow, data: { type: 'pulpo-sandbox:ready' } }))
        window.dispatchEvent(new MessageEvent('message', { source: original.contentWindow, data: { type: 'pulpo-sandbox:rendered' } }))
      })
      const cell = [...doc.getMap<Y.Map<unknown>>('cells').values()][0]!
      act(() => cell.set('outputs', { json: JSON.stringify([output('new content')]), assets: [] }))
      await waitFor(() => expect(view.container.querySelector('iframe')).not.toBe(original))
      const replacement = view.container.querySelector('iframe')!
      expect(replacement).toBeTruthy()
      const messages: unknown[] = []
      replacement.contentWindow!.postMessage = (message: unknown) => { messages.push(message) }
      await act(async () => { window.dispatchEvent(new MessageEvent('message', { source: replacement.contentWindow, data: { type: 'pulpo-sandbox:ready' } })) })
      expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ code: expect.stringContaining('new content') })]))
      // An identical output update keeps its running frame.
      await act(async () => { cell.set('outputs', { json: JSON.stringify([output('new content')]), assets: [] }) })
      expect(view.container.querySelector('iframe')).toBe(replacement)
    } finally {
      view.unmount()
      provider.destroy()
      doc.destroy()
    }
  })
})
