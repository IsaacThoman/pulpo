// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SocketIOYProvider } from '@pulpo/client-core/doc-sync'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { cellMetadata, cellsMap, cellSourceText, notebookCodec, orderedCells } from '@pulpo/client-core/office/notebook'
import { clearNotebookClipboard } from '@pulpo/client-core/office/notebook/view'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

async function openNotebook(cells: object[], editable = true, width: 'narrow' | 'fill' = 'narrow') {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  const provider = new SocketIOYProvider('notebook', doc)
  await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells })), { name: 'a.ipynb', assets })
  const view = render(<NotebookDocEditor session={{ doc, provider }} name="a.ipynb" editable={editable} width={width} assets={assets} />)
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

  it('puts even an empty cell on the clipboard as the browser copies, so Ctrl+V pastes it and not older text', async () => {
    const notebook = await openNotebook([code('a', '')])
    const setData = vi.fn()
    // The browser's copy event, as Chrome and Safari send it to the focused cell list.
    const execCommand = vi.fn(() => fireEvent.copy(document.body, { clipboardData: { setData, getData: () => '', types: [] } }))
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    try {
      notebook.list.focus()
      expect(fireEvent.keyDown(notebook.list, { key: 'c', ctrlKey: true })).toBe(false)
      expect(execCommand).toHaveBeenCalledWith('copy')
      expect(setData).toHaveBeenCalledWith('text/plain', '')
      // The clipboard now holds the empty cell's text, nothing.
      fireEvent.paste(document, { clipboardData: { getData: () => '', types: ['text/plain'] } })
      await waitFor(() => expect(notebook.sources()).toEqual(['', '']))
    } finally {
      delete (document as { execCommand?: unknown }).execCommand
      notebook.dispose()
    }
  })

  it('pastes the cells copied here when the clipboard refused them, not the older text it kept', async () => {
    const notebook = await openNotebook([code('a', 'print(1)')])
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true })
    const older = { clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'OLD TEXT FROM ANOTHER APP' : ''), types: ['text/plain'] } }
    try {
      notebook.list.focus()
      fireEvent.keyDown(notebook.list, { key: 'c', ctrlKey: true })
      fireEvent.paste(document, older)
      await waitFor(() => expect(notebook.sources()).toEqual(['print(1)', 'print(1)']))
      // Something copied since (here, text on the page) is what pastes next.
      fireEvent.copy(document.body)
      notebook.list.focus()
      fireEvent.paste(document, older)
      await waitFor(() => expect(notebook.sources()).toEqual(['print(1)', 'print(1)', 'OLD TEXT FROM ANOTHER APP']))
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard
      notebook.dispose()
    }
  })

  it('pastes in command mode without pasting into the text of a cell the page selection was left in', async () => {
    const notebook = await openNotebook([code('a', 'keep this')])
    try {
      const content = await waitFor(() => {
        const found = notebook.view.container.querySelector<HTMLElement>('.cm-content')
        expect(found).toBeTruthy()
        return found!
      })
      notebook.list.focus()
      // After Escape the page's selection stays in the cell's text, and the browser sends the paste there.
      fireEvent.paste(content, { clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'XYZ' : ''), types: ['text/plain'] } })
      await waitFor(() => expect(notebook.sources()).toEqual(['keep this', 'XYZ']))
    } finally {
      notebook.dispose()
    }
  })

  it('leaves Ctrl+C to the browser while text is selected in an output', async () => {
    const notebook = await openNotebook([code('a', 'print(42)', [{ output_type: 'stream', name: 'stdout', text: 'the answer is 42' }])])
    try {
      const output = await screen.findByText('the answer is 42')
      notebook.list.focus()
      const range = document.createRange()
      range.selectNodeContents(output)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      // Not prevented: the browser copies the selected output text, and no cells are copied.
      expect(fireEvent.keyDown(notebook.list, { key: 'c', ctrlKey: true })).toBe(true)
      expect(fireEvent.keyDown(notebook.list, { key: 'x', ctrlKey: true })).toBe(true)
      expect(notebook.sources()).toEqual(['print(42)'])
      expect(screen.getByRole('button', { name: 'Paste cells below' }).hasAttribute('disabled')).toBe(true)
      // A selection left in a cell's editor (after Escape) does not count, nor does none at all.
      await waitFor(() => expect(notebook.view.container.querySelector('.cm-content')).toBeTruthy())
      range.selectNodeContents(notebook.view.container.querySelector('.cm-content')!)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      notebook.list.focus()
      expect(fireEvent.keyDown(notebook.list, { key: 'c', ctrlKey: true })).toBe(false)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Paste cells below' }).hasAttribute('disabled')).toBe(false))
      act(() => clearNotebookClipboard())
      window.getSelection()!.removeAllRanges()
      expect(fireEvent.keyDown(notebook.list, { key: 'c', ctrlKey: true })).toBe(false)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Paste cells below' }).hasAttribute('disabled')).toBe(false))
    } finally {
      window.getSelection()?.removeAllRanges()
      notebook.dispose()
    }
  })

  it('names and spell checks a cell by the type Ctrl+M M and Y change it to while typing', async () => {
    const notebook = await openNotebook([code('a', '')])
    try {
      notebook.list.focus()
      fireEvent.keyDown(notebook.list, { key: 'Enter' })
      const content = await waitFor(() => {
        const found = notebook.view.container.querySelector<HTMLElement>('[data-mode="edit"] .cm-content')
        expect(found).toBeTruthy()
        return found!
      })
      const shown = () => ({ label: content.getAttribute('aria-label'), spellcheck: content.getAttribute('spellcheck'), hint: content.parentElement!.querySelector('.cm-placeholder')?.textContent })
      expect(shown()).toEqual({ label: 'Code cell', spellcheck: 'false', hint: 'Write code' })
      fireEvent.keyDown(content, { key: 'm', ctrlKey: true })
      fireEvent.keyDown(content, { key: 'm' })
      // Still editing, in the same editor, which now reads as the Markdown cell it is.
      await waitFor(() => expect(shown()).toEqual({ label: 'Markdown cell', spellcheck: 'true', hint: 'Write Markdown' }))
      expect(notebook.view.container.querySelector('[data-mode="edit"] .cm-content')).toBe(content)
      fireEvent.keyDown(content, { key: 'm', ctrlKey: true })
      fireEvent.keyDown(content, { key: 'y' })
      await waitFor(() => expect(shown()).toEqual({ label: 'Code cell', spellcheck: 'false', hint: 'Write code' }))
    } finally {
      notebook.dispose()
    }
  })

  it('ends a Ctrl+M chord on any other key, so Ctrl+M then X cuts nothing', async () => {
    const notebook = await openNotebook([code('a', 'first'), code('b', 'second')])
    try {
      notebook.list.focus()
      fireEvent.keyDown(notebook.list, { key: 'm', ctrlKey: true })
      expect(fireEvent.keyDown(notebook.list, { key: 'x' })).toBe(false)
      expect(notebook.sources()).toEqual(['first', 'second'])
      // The chord is over: X cuts again.
      fireEvent.keyDown(notebook.list, { key: 'x' })
      await waitFor(() => expect(notebook.sources()).toEqual(['second']))
    } finally {
      notebook.dispose()
    }
  })

  it('offers pasting in the cell\'s own menu as soon as cells are copied', async () => {
    const notebook = await openNotebook([code('a', 'first')])
    try {
      notebook.list.focus()
      fireEvent.keyDown(notebook.list, { key: 'c' })
      fireEvent.keyDown(screen.getByRole('button', { name: 'More cell actions' }), { key: 'ArrowDown' })
      const paste = await screen.findByRole('menuitem', { name: /Paste cells below/ })
      expect(paste.hasAttribute('data-disabled')).toBe(false)
    } finally {
      notebook.dispose()
    }
  })

  it('opens the table of contents from the remembered choice, but not over the cells in the side panel', async () => {
    localStorage.setItem('pulpo:notebook:outline', 'true')
    try {
      const wide = await openNotebook([{ id: 'h', cell_type: 'markdown', metadata: {}, source: '# Results' }])
      expect(wide.view.container.querySelector('[data-notebook-outline]')).toBeTruthy()
      wide.dispose()
      const side = await openNotebook([{ id: 'h', cell_type: 'markdown', metadata: {}, source: '# Results' }], true, 'fill')
      try {
        expect(side.view.container.querySelector('[data-notebook-outline]')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Table of contents' }))
        expect(side.view.container.querySelector('[data-notebook-outline]')).toBeTruthy()
      } finally {
        side.dispose()
      }
    } finally {
      localStorage.removeItem('pulpo:notebook:outline')
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

  it('steps through find matches with F3 and Ctrl+G from the cell list, where stepping to another cell leaves the keyboard', async () => {
    const notebook = await openNotebook([code('a', 'needle = 1'), code('b', 'print(needle)'), code('c', 'needle += 1')])
    try {
      notebook.list.focus()
      // With the bar closed, F3 opens it.
      fireEvent.keyDown(notebook.list, { key: 'F3' })
      const field = await screen.findByRole('textbox', { name: 'Find in notebook' })
      fireEvent.change(field, { target: { value: 'needle' } })
      expect(screen.getByText('1 of 3')).toBeTruthy()
      notebook.list.focus()
      expect(fireEvent.keyDown(notebook.list, { key: 'F3' })).toBe(false)
      expect(screen.getByText('2 of 3')).toBeTruthy()
      fireEvent.keyDown(notebook.list, { key: 'g', ctrlKey: true })
      expect(screen.getByText('3 of 3')).toBeTruthy()
      fireEvent.keyDown(notebook.list, { key: 'F3', shiftKey: true })
      expect(screen.getByText('2 of 3')).toBeTruthy()
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

  it('scrolls outputs again with one Shift+O when the selection also holds a cell without outputs', async () => {
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-output-content') ? 2_000 : 0 } })
    const notebook = await openNotebook([
      { id: 'm', cell_type: 'markdown', metadata: {}, source: 'Notes' },
      code('a', 'train()', [{ output_type: 'stream', name: 'stdout', text: 'epoch\n'.repeat(2_000) }]),
    ])
    try {
      await waitFor(() => expect(notebook.view.container.querySelector('[data-output-scroll]')).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Show full output' }))
      expect(notebook.view.container.querySelector('[data-output-scroll]')).toBeNull()
      notebook.list.focus()
      fireEvent.keyDown(notebook.list, { key: 'Home' })
      fireEvent.keyDown(notebook.list, { key: 'ArrowDown', shiftKey: true })
      await screen.findByText('2 cells selected')
      fireEvent.keyDown(notebook.list, { key: 'O', shiftKey: true })
      await waitFor(() => expect(notebook.view.container.querySelector('[data-output-scroll]')).toBeTruthy())
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
      notebook.dispose()
    }
  })
})

describe('notebook cell context menu', () => {
  const cellSection = (container: HTMLElement, index: number) => container.querySelectorAll<HTMLElement>('[data-cell-key]')[index]!
  /** A right-click as a mouse makes it: the press selects the cell, then the menu event comes. */
  const rightClick = (target: HTMLElement) => {
    fireEvent.mouseDown(target, { button: 2 })
    return fireEvent.contextMenu(target, { button: 2 })
  }

  it('opens on a cell\'s chrome, acts on that cell, and gives the keyboard back to the cells', async () => {
    const notebook = await openNotebook([code('a', 'first'), code('b', 'second')])
    try {
      expect(rightClick(cellSection(notebook.view.container, 1))).toBe(false)
      const menu = await screen.findByRole('menu', { name: 'Cell actions' })
      expect(cellSection(notebook.view.container, 1).hasAttribute('data-active')).toBe(true)
      fireEvent.click(within(menu).getByRole('menuitem', { name: /Duplicate cell/ }))
      await waitFor(() => expect(notebook.sources()).toEqual(['first', 'second', 'second']))
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
      await waitFor(() => expect(document.activeElement).toBe(notebook.list))
    } finally {
      notebook.dispose()
    }
  })

  it('keeps a selection the right-clicked cell is part of', async () => {
    const notebook = await openNotebook([code('a', 'one'), code('b', 'two'), code('c', 'three')])
    try {
      notebook.list.focus()
      fireEvent.keyDown(notebook.list, { key: 'ArrowDown', shiftKey: true })
      await screen.findByText('2 cells selected')
      rightClick(cellSection(notebook.view.container, 0))
      const menu = await screen.findByRole('menu', { name: 'Cell actions' })
      expect(screen.getByText('2 cells selected')).toBeTruthy()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete cells' }))
      await waitFor(() => expect(notebook.sources()).toEqual(['three']))
    } finally {
      notebook.dispose()
    }
  })

  it('leaves the browser\'s menu in a cell\'s code, and offers output commands only with outputs', async () => {
    const notebook = await openNotebook([code('a', 'print(1)', [{ output_type: 'stream', name: 'stdout', text: '1' }]), { id: 'm', cell_type: 'markdown', metadata: {}, source: 'Notes' }])
    try {
      await waitFor(() => expect(notebook.view.container.querySelector('.cm-content')).toBeTruthy())
      expect(fireEvent.contextMenu(notebook.view.container.querySelector('.cm-content')!)).toBe(true)
      expect(screen.queryByRole('menu')).toBeNull()
      rightClick(cellSection(notebook.view.container, 0))
      expect(within(await screen.findByRole('menu', { name: 'Cell actions' })).getByRole('menuitem', { name: /Copy output text/ })).toBeTruthy()
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
      rightClick(cellSection(notebook.view.container, 1))
      const markdownMenu = await screen.findByRole('menu', { name: 'Cell actions' })
      expect(within(markdownMenu).queryByRole('menuitem', { name: /Copy output text/ })).toBeNull()
    } finally {
      notebook.dispose()
    }
  })

  it('opens beside the active cell from the keyboard\'s menu key', async () => {
    const notebook = await openNotebook([code('a', 'first')])
    try {
      notebook.list.focus()
      expect(fireEvent.contextMenu(notebook.list, { button: 0 })).toBe(false)
      await screen.findByRole('menu', { name: 'Cell actions' })
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
      await waitFor(() => expect(document.activeElement).toBe(notebook.list))
      // Shift+F10 too, where the browser sends no menu event for it.
      expect(fireEvent.keyDown(notebook.list, { key: 'F10', shiftKey: true })).toBe(false)
      await screen.findByRole('menu', { name: 'Cell actions' })
    } finally {
      notebook.dispose()
    }
  })

  it('leaves the browser\'s menu for a Control-click or a touch on the space around the cells', async () => {
    const notebook = await openNotebook([code('a', 'first')])
    try {
      notebook.list.focus()
      // A Mac's Control-click sends the primary button with Control held; it is a pointer, not the menu key.
      expect(fireEvent.contextMenu(notebook.list, { button: 0, ctrlKey: true })).toBe(true)
      const touch = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0 })
      Object.defineProperty(touch, 'pointerType', { value: 'touch' })
      expect(fireEvent(notebook.list, touch)).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(screen.queryByRole('menu')).toBeNull()
    } finally {
      notebook.dispose()
    }
  })
})
