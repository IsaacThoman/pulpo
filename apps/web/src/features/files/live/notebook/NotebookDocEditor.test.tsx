// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SocketIOYProvider } from '@pulpo/client-core/doc-sync'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { cellMetadata, cellsMap, cellSourceText, notebookCodec, orderedCells } from '@pulpo/client-core/office/notebook'
import { clearNotebookClipboard } from '@pulpo/client-core/office/notebook/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { NotebookDocEditor } from './NotebookDocEditor'

// jsdom has no layout or scrolling.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  cleanup()
  clearNotebookClipboard()
})

describe('notebook output frames', () => {
  // Outputs resolve asynchronously, which takes longer when the suite runs files in parallel.
  it.each(['text/html', 'application/javascript'])('remounts a replaced %s output at the same index', { timeout: 15_000 }, async (mime) => {
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
      await waitFor(() => expect(view.container.querySelector('iframe')).toBeTruthy(), { timeout: 5_000 })
      const original = view.container.querySelector('iframe')!
      // Finish the initial sandbox render before replacing it, reproducing the stale-frame case.
      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', { source: original.contentWindow, data: { type: 'pulpo-sandbox:ready' } }))
        window.dispatchEvent(new MessageEvent('message', { source: original.contentWindow, data: { type: 'pulpo-sandbox:rendered' } }))
      })
      const cell = [...doc.getMap<Y.Map<unknown>>('cells').values()][0]!
      act(() => cell.set('outputs', { json: JSON.stringify([output('new content')]), assets: [] }))
      await waitFor(() => expect(view.container.querySelector('iframe')).not.toBe(original), { timeout: 5_000 })
      const replacement = view.container.querySelector('iframe')!
      expect(replacement).toBeTruthy()
      const messages: unknown[] = []
      replacement.contentWindow!.postMessage = (message: unknown) => { messages.push(message) }
      await waitFor(() => {
        window.dispatchEvent(new MessageEvent('message', { source: replacement.contentWindow, data: { type: 'pulpo-sandbox:ready' } }))
        expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ code: expect.stringContaining('new content') })]))
      })
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


it('refreshes a Markdown image when only its attachment asset changes', async () => {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  const provider = new SocketIOYProvider('notebook', doc)
  const file = (image: string) => new TextEncoder().encode(JSON.stringify({
    nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{
      id: 'a', cell_type: 'markdown', source: '![plot](attachment:plot.png)', metadata: {},
      attachments: { 'plot.png': { 'image/png': image } },
    }],
  }))
  await notebookCodec.importFile(doc, file('AAAA'.repeat(300)), { name: 'a.ipynb', assets })
  const view = render(<NotebookDocEditor session={{ doc, provider }} name="a.ipynb" editable={false} width="fill" assets={assets} />)
  try {
    const image = () => view.container.querySelector('img')?.getAttribute('src')
    await waitFor(() => expect(image()).toBe(`data:image/png;base64,${'AAAA'.repeat(300)}`))
    const before = cellsMap(doc).values().next().value!.get('attachments')
    await act(async () => { await notebookCodec.applyFile(doc, file('AQEB'.repeat(300)), { name: 'a.ipynb', assets }) })
    const after = cellsMap(doc).values().next().value!.get('attachments')
    expect(after.json).toBe(before.json)
    expect(after.assets).not.toEqual(before.assets)
    await waitFor(() => expect(image()).toBe(`data:image/png;base64,${'AQEB'.repeat(300)}`))
  } finally {
    view.unmount()
    provider.destroy()
    doc.destroy()
  }
})

async function openNotebook(cells: object[], editable = true) {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  const provider = new SocketIOYProvider('notebook', doc)
  await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells })), { name: 'a.ipynb', assets })
  const view = render(<NotebookDocEditor session={{ doc, provider }} name="a.ipynb" editable={editable} width="narrow" assets={assets} />)
  const list = await screen.findByRole('list', { name: 'Notebook cells' })
  return {
    doc,
    view,
    list,
    sources: () => orderedCells(doc).map(({ cell }) => cellSourceText(cell)),
    dispose: () => {
      view.unmount()
      provider.destroy()
      doc.destroy()
    },
  }
}

const code = (id: string, source: string, outputs: object[] = []) => ({ id, cell_type: 'code', metadata: {}, execution_count: null, outputs, source })

describe('notebook editor parity', () => {
  it('lets viewers open hidden code and outputs for themselves without changing the notebook', async () => {
    const hidden = { ...code('a', 'secret = 1', [{ output_type: 'stream', name: 'stdout', text: 'shown later' }]), metadata: { jupyter: { source_hidden: true, outputs_hidden: true } } }
    const notebook = await openNotebook([hidden], false)
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Source hidden' }))
      await waitFor(() => expect(notebook.view.container.textContent).toContain('secret = 1'))
      fireEvent.click(await screen.findByRole('button', { name: '1 output hidden' }))
      await waitFor(() => expect(notebook.view.container.textContent).toContain('shown later'))
      const metadata = cellMetadata(orderedCells(notebook.doc)[0]!.cell)!
      expect(JSON.parse(metadata.get('jupyter')!)).toEqual({ source_hidden: true, outputs_hidden: true })
    } finally {
      notebook.dispose()
    }
  })

  it('shows hidden code for everyone when an editor opens it, and gives the keyboard back to the cells', async () => {
    const notebook = await openNotebook([{ ...code('a', 'x = 1'), metadata: { jupyter: { source_hidden: true } } }])
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Source hidden' }))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Source hidden' })).toBeNull())
      expect(cellMetadata(orderedCells(notebook.doc)[0]!.cell)!.has('jupyter')).toBe(false)
      expect(document.activeElement).toBe(notebook.list)
    } finally {
      notebook.dispose()
    }
  })

  it('copies and pastes cells with Ctrl+C and Ctrl+V in command mode', async () => {
    const notebook = await openNotebook([code('a', 'first'), code('b', 'second')])
    try {
      notebook.list.focus()
      fireEvent.keyDown(notebook.list, { key: 'c', ctrlKey: true })
      // jsdom sends no paste event, as some browsers do not to a focused list: cells copied here still paste.
      fireEvent.keyDown(notebook.list, { key: 'v', ctrlKey: true })
      await waitFor(() => expect(notebook.sources()).toEqual(['first', 'first', 'second']))
    } finally {
      notebook.dispose()
    }
  })

  it('pastes text from elsewhere as a new code cell, one undo step', async () => {
    const notebook = await openNotebook([code('a', 'first')])
    try {
      notebook.list.focus()
      fireEvent.paste(document, { clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'print("from a web page")' : ''), types: ['text/plain'] } })
      await waitFor(() => expect(notebook.sources()).toEqual(['first', 'print("from a web page")']))
      fireEvent.keyDown(notebook.list, { key: 'z' })
      await waitFor(() => expect(notebook.sources()).toEqual(['first']))
    } finally {
      notebook.dispose()
    }
  })

  it('toggles line numbers in code cells with Shift+L', async () => {
    const notebook = await openNotebook([code('a', 'x = 1\ny = 2')])
    try {
      await waitFor(() => expect(notebook.view.container.querySelector('.cm-editor')).toBeTruthy())
      expect(notebook.view.container.querySelector('.cm-lineNumbers')).toBeNull()
      notebook.list.focus()
      fireEvent.keyDown(notebook.list, { key: 'L', shiftKey: true })
      await waitFor(() => expect(notebook.view.container.querySelector('.cm-lineNumbers')).toBeTruthy())
      fireEvent.keyDown(notebook.list, { key: 'L', shiftKey: true })
      await waitFor(() => expect(notebook.view.container.querySelector('.cm-lineNumbers')).toBeNull())
    } finally {
      notebook.dispose()
    }
  })

  it('opens the find bar with Ctrl+F in command mode and gives the keyboard back on Escape', async () => {
    const notebook = await openNotebook([code('a', 'needle = 1'), code('b', 'print(needle)')])
    try {
      notebook.list.focus()
      fireEvent.keyDown(notebook.list, { key: 'f', ctrlKey: true })
      const field = await screen.findByRole('textbox', { name: 'Find in notebook' })
      expect(document.activeElement).toBe(field)
      fireEvent.change(field, { target: { value: 'needle' } })
      expect(screen.getByText('1 of 2')).toBeTruthy()
      fireEvent.keyDown(field, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('search')).toBeNull())
      // The match is selected in its cell, ready to type over.
      await waitFor(() => expect(document.activeElement?.closest('.cm-editor')).toBeTruthy())
    } finally {
      notebook.dispose()
    }
  })

  it('scrolls tall outputs inside their cell, with a toggle to show them in full', async () => {
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-output-content') ? 2_000 : 0 } })
    const notebook = await openNotebook([code('a', 'train()', [{ output_type: 'stream', name: 'stdout', text: 'epoch\n'.repeat(2_000) }])])
    try {
      await waitFor(() => expect(notebook.view.container.querySelector('[data-output-scroll]')).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Show full output' }))
      expect(notebook.view.container.querySelector('[data-output-scroll]')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Scroll output' }))
      expect(notebook.view.container.querySelector('[data-output-scroll]')).toBeTruthy()
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
      notebook.dispose()
    }
  })
})
