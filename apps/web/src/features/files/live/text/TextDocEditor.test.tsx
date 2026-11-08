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

  it('spell checks prose but not code', async () => {
    const notes = await open('teh notes\n')
    expect(notes.view.container.querySelector('.cm-content')!.getAttribute('spellcheck')).toBe('true')
    cleanup()
    const code = await open('x = 1\n', { name: 'main.py' })
    expect(code.view.container.querySelector('.cm-content')!.getAttribute('spellcheck')).toBe('false')
  })

  it('wraps lines with Alt+Z (Option+Z on a Mac) without typing it', async () => {
    const opened = await open('alpha\n')
    const content = opened.view.container.querySelector('.cm-content')!
    expect(fireEvent.keyDown(content, { key: 'Ω', code: 'KeyZ', altKey: true })).toBe(false)
    expect(opened.view.container.querySelector('.cm-lineWrapping')).toBeTruthy()
    fireEvent.keyDown(content, { key: 'z', code: 'KeyZ', altKey: true })
    expect(opened.view.container.querySelector('.cm-lineWrapping')).toBeNull()
    expect(opened.text()).toBe('alpha\n')
  })

  it('leaves Option+Z to type its letter on a Mac layout that has one, and AltGr+Z elsewhere', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
    try {
      const opened = await open('alpha\n')
      const content = opened.view.container.querySelector('.cm-content')!
      const wrapped = () => Boolean(opened.view.container.querySelector('.cm-lineWrapping'))
      // Polish Pro types ż, Latvian ž, and German ¥ (on its Y key, where US has Z): not a shortcut.
      expect(fireEvent.keyDown(content, { key: 'ż', code: 'KeyZ', altKey: true })).toBe(true)
      expect(fireEvent.keyDown(content, { key: 'ž', code: 'KeyZ', altKey: true })).toBe(true)
      expect(fireEvent.keyDown(content, { key: '¥', code: 'KeyZ', altKey: true })).toBe(true)
      expect(wrapped()).toBe(false)
      // US and ABC type Ω, as German does with its Z key: VS Code's Option+Z.
      expect(fireEvent.keyDown(content, { key: 'Ω', code: 'KeyZ', altKey: true })).toBe(false)
      expect(wrapped()).toBe(true)
      expect(fireEvent.keyDown(content, { key: 'Ω', code: 'KeyY', altKey: true })).toBe(false)
      expect(wrapped()).toBe(false)
    } finally {
      delete (navigator as { platform?: string }).platform
    }
    cleanup()
    const windows = await open('alpha\n')
    const content = windows.view.container.querySelector('.cm-content')!
    // AltGr (Ctrl+Alt on Windows, AltGraph on Linux) types ż on Polish keyboards; Alt+Y on a German one is not Alt+Z.
    expect(fireEvent.keyDown(content, { key: 'ż', code: 'KeyZ', altKey: true, ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(content, { key: 'ż', code: 'KeyZ', altKey: true, modifierAltGraph: true } as KeyboardEventInit)).toBe(true)
    expect(fireEvent.keyDown(content, { key: 'y', code: 'KeyZ', altKey: true })).toBe(true)
    expect(windows.view.container.querySelector('.cm-lineWrapping')).toBeNull()
    // Alt+Я (Russian) is the Z key, and types nothing.
    expect(fireEvent.keyDown(content, { key: 'я', code: 'KeyZ', altKey: true })).toBe(false)
    expect(windows.view.container.querySelector('.cm-lineWrapping')).toBeTruthy()
  })

  it('remembers line numbers and zoom, and the status bar resets the zoom', async () => {
    localStorage.setItem('pulpo:text-editor:line-numbers', 'false')
    localStorage.setItem('pulpo:text-editor:zoom', '1.5')
    try {
      const opened = await open('alpha\n')
      expect(opened.view.container.querySelector('.cm-lineNumbers')).toBeNull()
      const surface = opened.view.container.querySelector<HTMLElement>('[data-text-editor]')!
      expect(surface.style.getPropertyValue('--pulpo-code-font-size')).toBe('19.5px')
      fireEvent.click(screen.getByRole('button', { name: 'Zoom 150%, reset to 100%' }))
      expect(surface.style.getPropertyValue('--pulpo-code-font-size')).toBe('13px')
      expect(localStorage.getItem('pulpo:text-editor:zoom')).toBe('1')
      expect(opened.view.container.querySelector('[data-text-zoom]')).toBeNull()
    } finally {
      localStorage.removeItem('pulpo:text-editor:line-numbers')
      localStorage.removeItem('pulpo:text-editor:zoom')
    }
  })

  it('ignores a stored zoom out of bounds', async () => {
    localStorage.setItem('pulpo:text-editor:zoom', '9')
    try {
      const opened = await open('alpha\n')
      expect(opened.view.container.querySelector<HTMLElement>('[data-text-editor]')!.style.getPropertyValue('--pulpo-code-font-size')).toBe('13px')
    } finally {
      localStorage.removeItem('pulpo:text-editor:zoom')
    }
  })

  it('keeps working when the browser refuses storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const opened = await open('alpha\n')
    fireEvent.click(screen.getByRole('button', { name: 'Wrap lines' }))
    expect(opened.view.container.querySelector('.cm-lineWrapping')).toBeTruthy()
  })
})
