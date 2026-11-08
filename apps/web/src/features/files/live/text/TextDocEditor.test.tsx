// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SocketIOYProvider } from '@pulpo/client-core/doc-sync'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { textCodec } from '@pulpo/client-core/office/text'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { TextDocEditor } from './TextDocEditor'

// jsdom has no layout or scrolling.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const disposers: Array<() => void> = []
afterEach(() => {
  cleanup()
  for (const dispose of disposers.splice(0).reverse()) dispose()
  vi.restoreAllMocks()
})

async function open(text: string, options: { name?: string; editable?: boolean; width?: 'narrow' | 'fill' } = {}) {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  const name = options.name ?? 'notes.txt'
  await textCodec.importFile(doc, new TextEncoder().encode(text), { name, assets })
  const provider = new SocketIOYProvider('text', doc)
  const view = render(<TextDocEditor session={{ doc, provider }} name={name} editable={options.editable ?? true} width={options.width ?? 'narrow'} assets={assets} />)
  disposers.push(() => { provider.destroy(); doc.destroy() })
  await waitFor(() => expect(view.container.querySelector('.cm-content')).toBeTruthy())
  return { doc, view, text: () => doc.getText('text').toString() }
}

const field = (name: string) => document.querySelector(`.cm-search input[name=${name}]`)

describe('text editor find and status bar', () => {
  it('leaves the caret in the find field when the Find button opens it', async () => {
    await open('alpha\nbeta\n')
    fireEvent.click(screen.getByRole('button', { name: 'Find and replace' }))
    expect(document.activeElement).toBe(field('search'))
  })

  it('takes the keyboard when the file opens, but not in the side panel', async () => {
    const opened = await open('alpha\n')
    expect(document.activeElement).toBe(opened.view.container.querySelector('.cm-content'))
    cleanup()
    const panel = await open('alpha\n', { width: 'fill' })
    expect(document.activeElement).not.toBe(panel.view.container.querySelector('.cm-content'))
  })

  it('opens find, replace, and go to line from the toolbar and status bar too', async () => {
    await open('alpha\nbeta\n')
    const wrap = screen.getByRole('button', { name: 'Wrap lines' })
    wrap.focus()
    fireEvent.keyDown(wrap, { key: 'f', ctrlKey: true })
    expect(document.activeElement).toBe(field('search'))
    wrap.focus()
    fireEvent.keyDown(wrap, { key: 'g', ctrlKey: true })
    expect(document.querySelector('.cm-goto-line')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Go to line (Ctrl+G)'))
    expect(document.activeElement).toBe(document.querySelector('.cm-goto-line input'))
  })

  it('counts lines always, and words in prose files', async () => {
    const prose = await open('one two three\nfour\n')
    await waitFor(() => expect(prose.view.container.querySelector('[data-text-counts]')!.textContent).toBe('4 words3 lines'))
    cleanup()
    const code = await open('x = 1\n', { name: 'main.py' })
    expect(code.view.container.querySelector('[data-text-counts]')!.textContent).toBe('2 lines')
  })

  it('keeps working when the browser refuses storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const opened = await open('alpha\n')
    fireEvent.click(screen.getByRole('button', { name: 'Wrap lines' }))
    expect(opened.view.container.querySelector('.cm-lineWrapping')).toBeTruthy()
  })
})
