// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorMenuBar } from './EditorMenuBar'
import type { MenuDefinition } from './menu'
import { formatShortcut } from './shortcuts'

afterEach(cleanup)

const noop = () => {}

function Editor({ onUndo = noop, onPick = noop, onClose = noop }: { onUndo?: () => void; onPick?: (size: string) => void; onClose?: () => void }) {
  const [wrap, setWrap] = useState(false)
  const [layout, setLayout] = useState<'print' | 'web'>('print')
  const menus: MenuDefinition[] = [
    { id: 'file', label: 'File', items: () => [{ type: 'item', id: 'print', label: 'Print', shortcut: { key: 'p', mod: true }, onSelect: () => {} }] },
    {
      id: 'edit',
      label: 'Edit',
      items: () => [
        { type: 'item', id: 'undo', label: 'Undo', onSelect: onUndo },
        { type: 'item', id: 'redo', label: 'Redo', disabled: true, onSelect: () => {} },
        { type: 'separator' },
        { type: 'item', id: 'clear', label: 'Delete all', destructive: true, onSelect: () => {} },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: () => [
        { type: 'item', id: 'wrap', label: 'Wrap lines', checked: wrap, onSelect: () => setWrap(!wrap) },
        { type: 'label', label: 'Layout' },
        { type: 'item', id: 'print-layout', label: 'Print layout', radio: true, checked: layout === 'print', onSelect: () => setLayout('print') },
        { type: 'item', id: 'web-layout', label: 'Web layout', radio: true, checked: layout === 'web', onSelect: () => setLayout('web') },
        {
          type: 'submenu',
          id: 'table',
          label: 'Table',
          items: [{ type: 'custom', id: 'grid', render: (close) => <button type="button" onClick={() => { onPick('2x2'); close() }}>2 by 2</button> }],
        },
      ],
    },
  ]
  return (
    <>
      <EditorMenuBar menus={menus} onClose={onClose} />
      <textarea aria-label="Document" />
    </>
  )
}

const trigger = (name: string) => screen.getByRole('menuitem', { name })
const openMenus = () => screen.queryAllByRole('menu')

describe('EditorMenuBar', () => {
  it('is a menu bar of text menus with one tab stop, moved by ArrowLeft and ArrowRight', () => {
    render(<Editor />)
    expect(screen.getByRole('menubar', { name: 'Menu bar' })).toBeTruthy()
    expect(['File', 'Edit', 'View'].map((name) => trigger(name).tabIndex)).toEqual([0, -1, -1])
    trigger('File').focus()
    fireEvent.keyDown(trigger('File'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(trigger('Edit'))
    expect(trigger('Edit').tabIndex).toBe(0)
    fireEvent.keyDown(trigger('Edit'), { key: 'ArrowLeft' })
    // The search button ends the bar, so ArrowLeft from the first menu wraps to it.
    fireEvent.keyDown(trigger('File'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(trigger('Search the menus'))
    fireEvent.keyDown(trigger('Search the menus'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(trigger('View'))
    fireEvent.keyDown(trigger('View'), { key: 'End' })
    expect(document.activeElement).toBe(trigger('Search the menus'))
    fireEvent.keyDown(trigger('Search the menus'), { key: 'Home' })
    expect(document.activeElement).toBe(trigger('File'))
  })

  it('opens one menu at a time and moves between open menus with the arrow keys', async () => {
    render(<Editor />)
    fireEvent.keyDown(trigger('File'), { key: 'Enter' })
    const print = await screen.findByRole('menuitem', { name: /Print/ })
    expect(print.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+P$/)
    expect(print.textContent).toMatch(/(⌘P|Ctrl\+P)$/)
    fireEvent.keyDown(print, { key: 'ArrowRight' })
    expect(await screen.findByRole('menuitem', { name: 'Undo' })).toBeTruthy()
    await waitFor(() => expect(openMenus()).toHaveLength(1))
    expect(trigger('Edit').getAttribute('aria-expanded')).toBe('true')
    expect(trigger('File').getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Undo' }), { key: 'ArrowLeft' })
    expect(await screen.findByRole('menuitem', { name: /Print/ })).toBeTruthy()
  })

  it('switches to the menu under the pointer while one is open, not before', async () => {
    render(<Editor />)
    fireEvent.pointerEnter(trigger('Edit'))
    expect(openMenus()).toHaveLength(0)
    fireEvent.keyDown(trigger('File'), { key: 'Enter' })
    await screen.findByRole('menuitem', { name: /Print/ })
    fireEvent.pointerEnter(trigger('View'))
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Wrap lines' })).toBeTruthy()
    expect(trigger('View').getAttribute('aria-expanded')).toBe('true')
    expect(trigger('File').getAttribute('aria-expanded')).toBe('false')
  })

  it('runs commands, shows disabled and destructive items, and hands focus back on close', async () => {
    const onUndo = vi.fn()
    const onClose = vi.fn()
    render(<Editor onUndo={onUndo} onClose={onClose} />)
    fireEvent.keyDown(trigger('Edit'), { key: 'Enter' })
    const redo = await screen.findByRole('menuitem', { name: 'Redo' })
    expect(redo.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Delete all' }).getAttribute('data-variant')).toBe('destructive')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledOnce()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(openMenus()).toHaveLength(0)

    fireEvent.keyDown(trigger('Edit'), { key: 'Enter' })
    const undo = await screen.findByRole('menuitem', { name: 'Undo' })
    fireEvent.keyDown(undo, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2))
  })

  it('leaves focus where a command put it', async () => {
    const onClose = vi.fn()
    function Focusing() {
      const menus: MenuDefinition[] = [{ id: 'file', label: 'File', items: () => [{ type: 'item', id: 'rename', label: 'Rename', onSelect: () => document.getElementById('title')?.focus() }] }]
      return <><input id="title" aria-label="Title" /><EditorMenuBar menus={menus} onClose={onClose} /></>
    }
    render(<Focusing />)
    fireEvent.keyDown(trigger('File'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    await waitFor(() => expect(openMenus()).toHaveLength(0))
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows checked toggles and choices from fresh state each time a menu opens', async () => {
    render(<Editor />)
    fireEvent.keyDown(trigger('View'), { key: 'Enter' })
    const wrap = await screen.findByRole('menuitemcheckbox', { name: 'Wrap lines' })
    expect(wrap.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('menuitemradio', { name: 'Print layout' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(wrap)
    await waitFor(() => expect(openMenus()).toHaveLength(0))
    fireEvent.keyDown(trigger('View'), { key: 'Enter' })
    expect((await screen.findByRole('menuitemcheckbox', { name: 'Wrap lines' })).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Web layout' }))
    await waitFor(() => expect(openMenus()).toHaveLength(0))
    fireEvent.keyDown(trigger('View'), { key: 'Enter' })
    expect((await screen.findByRole('menuitemradio', { name: 'Web layout' })).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'Print layout' }).getAttribute('aria-checked')).toBe('false')
  })

  it('lines rows without an icon up with the labels of rows that have one', async () => {
    const Icon = ({ className }: { className?: string }) => <svg className={className} />
    const menus: MenuDefinition[] = [{
      id: 'edit',
      label: 'Edit',
      items: () => [
        { type: 'item', id: 'cut', label: 'Cut', icon: Icon, onSelect: noop },
        { type: 'item', id: 'select-all', label: 'Select all', onSelect: noop },
      ],
    }, { id: 'tools', label: 'Tools', items: () => [{ type: 'item', id: 'about', label: 'About', onSelect: noop }] }]
    render(<EditorMenuBar menus={menus} />)
    fireEvent.keyDown(trigger('Edit'), { key: 'Enter' })
    expect((await screen.findByRole('menuitem', { name: 'Select all' })).hasAttribute('data-inset')).toBe(true)
    expect(screen.getByRole('menuitem', { name: 'Cut' }).hasAttribute('data-inset')).toBe(false)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Cut' }), { key: 'ArrowRight' })
    expect((await screen.findByRole('menuitem', { name: 'About' })).hasAttribute('data-inset')).toBe(false)
  })

  it('opens submenus with custom content that can close the menu bar', async () => {
    const onPick = vi.fn()
    render(<Editor onPick={onPick} />)
    fireEvent.keyDown(trigger('View'), { key: 'Enter' })
    const table = await screen.findByRole('menuitem', { name: 'Table' })
    fireEvent.keyDown(table, { key: 'ArrowRight' })
    fireEvent.click(await screen.findByRole('button', { name: '2 by 2' }))
    expect(onPick).toHaveBeenCalledWith('2x2')
    await waitFor(() => expect(openMenus()).toHaveLength(0))
    // ArrowRight on the submenu's trigger opened it rather than moving to another menu.
    expect(trigger('View').tabIndex).toBe(0)
  })
})

describe('EditorMenuBar: Search the menus and the File menu key', () => {
  function Searchable({ onBold = noop, onClose = noop, items }: { onBold?: () => void; onClose?: () => void; items?: () => void }) {
    const [bold, setBold] = useState(false)
    const menus: MenuDefinition[] = [
      {
        id: 'file',
        label: 'File',
        items: () => [
          { type: 'item', id: 'print', label: 'Print', shortcut: { key: 'p', mod: true }, onSelect: noop },
          { type: 'item', id: 'rename', label: 'Rename', onSelect: () => document.getElementById('title')?.focus() },
        ],
      },
      {
        id: 'format',
        label: 'Format',
        items: () => {
          items?.()
          return [
            {
              type: 'submenu',
              id: 'text',
              label: 'Text',
              items: [
                { type: 'item', id: 'bold', label: 'Bold', checked: bold, shortcut: { key: 'b', mod: true }, onSelect: () => { setBold(!bold); onBold() } },
                { type: 'item', id: 'italic', label: 'Italic', onSelect: noop },
              ],
            },
            { type: 'custom', id: 'grid', render: () => <button type="button">Grid</button> },
            { type: 'item', id: 'clear', label: 'Clear formatting', disabled: true, onSelect: onBold },
          ]
        },
      },
      { id: 'help', label: 'Help', items: () => [{ type: 'item', id: 'keyboard-shortcuts', label: 'Keyboard shortcuts', onSelect: noop }] },
    ]
    return (
      <>
        <input id="title" aria-label="Title" />
        <div data-file-editor="document">
          <EditorMenuBar menus={menus} onClose={onClose} />
          <div role="textbox" aria-label="Document" tabIndex={0} />
          <input aria-label="Formula" />
        </div>
        <input aria-label="Chat" />
      </>
    )
  }

  const searchKey = { key: '/', code: 'Slash', altKey: true }
  const fileKey = { key: 'F', code: 'KeyF', altKey: true, shiftKey: true }
  const palette = () => screen.queryByRole('dialog', { name: 'Search the menus' })
  const field = () => screen.getByRole('combobox', { name: 'Search the menus' })
  const options = () => screen.queryAllByRole('option')
  const documentBox = () => screen.getByRole('textbox', { name: 'Document' })
  const openPalette = async (from: HTMLElement = documentBox()) => {
    from.focus()
    fireEvent.keyDown(from, searchKey)
    await screen.findByRole('dialog', { name: 'Search the menus' })
  }

  it('ends the bar with a search button and starts Help with Search the menus (Alt+/)', async () => {
    render(<Searchable />)
    const button = trigger('Search the menus')
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Alt+/')
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger('File').getAttribute('aria-keyshortcuts')).toBe('Alt+Shift+F')
    fireEvent.keyDown(trigger('Help'), { key: 'Enter' })
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Search the menusAlt+/', 'Keyboard shortcuts'])
    fireEvent.click(items[0]!)
    expect(await screen.findByRole('dialog', { name: 'Search the menus' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(field()))
    // The search never lists itself, nor custom rows such as a grid.
    expect(options().map((option) => option.getAttribute('data-menu-command'))).toEqual([
      'file/print', 'file/rename', 'format/text/bold', 'format/text/italic', 'format/clear', 'help/keyboard-shortcuts',
    ])
  })

  it('opens with Alt+/ only from inside the editor, reading the menus as it opens', async () => {
    const items = vi.fn()
    render(<Searchable items={items} />)
    expect(fireEvent.keyDown(screen.getByRole('textbox', { name: 'Chat' }), searchKey)).toBe(true)
    expect(fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), searchKey)).toBe(true)
    // AltGr (Ctrl+Alt on Windows) types characters, and a key the editor took stays the editor's.
    fireEvent.keyDown(documentBox(), { ...searchKey, ctrlKey: true })
    documentBox().addEventListener('keydown', (event) => event.preventDefault(), { once: true })
    fireEvent.keyDown(documentBox(), searchKey)
    expect(palette()).toBeNull()
    expect(items).not.toHaveBeenCalled()

    expect(fireEvent.keyDown(documentBox(), searchKey)).toBe(false)
    expect(await screen.findByRole('dialog', { name: 'Search the menus' })).toBeTruthy()
    expect(items).toHaveBeenCalledOnce()
  })

  it('finds commands by name and menu path, runs one with Enter, and hands focus back', async () => {
    const onBold = vi.fn()
    const onClose = vi.fn()
    render(<Searchable onBold={onBold} onClose={onClose} />)
    await openPalette()
    fireEvent.change(field(), { target: { value: 'text bo' } })
    expect(options().map((option) => option.textContent)).toEqual([`BoldFormat ▸ Text${formatShortcut({ key: 'b', mod: true })}`])
    const bold = options()[0]!
    expect(bold.getAttribute('aria-label')).toBe(`Bold, Format, Text, ${formatShortcut({ key: 'b', mod: true })}`)
    expect(bold.getAttribute('aria-selected')).toBe('true')
    expect(bold.getAttribute('aria-checked')).toBe('false')
    expect(field().getAttribute('aria-activedescendant')).toBe(bold.id)
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onBold).toHaveBeenCalledOnce()
    await waitFor(() => expect(palette()).toBeNull())
    expect(onClose).toHaveBeenCalledOnce()

    // Opened again, it shows the new state, and the arrow keys pick another row.
    await openPalette()
    fireEvent.change(field(), { target: { value: 'bold' } })
    expect(options()[0]!.getAttribute('aria-checked')).toBe('true')
    // One letter finds words that start with it, here the Text submenu's.
    fireEvent.change(field(), { target: { value: 't' } })
    expect(options().map((option) => option.getAttribute('data-menu-command'))).toEqual(['format/text/bold', 'format/text/italic'])
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('shows greyed commands that never run, and says when nothing matches', async () => {
    const onBold = vi.fn()
    render(<Searchable onBold={onBold} />)
    fireEvent.click(trigger('Search the menus'))
    await screen.findByRole('dialog', { name: 'Search the menus' })
    fireEvent.change(field(), { target: { value: 'clear' } })
    const clear = options()[0]!
    expect(clear.getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(field(), { key: 'Enter' })
    fireEvent.click(clear)
    expect(onBold).not.toHaveBeenCalled()
    expect(palette()).toBeTruthy()
    fireEvent.change(field(), { target: { value: 'zzzz' } })
    expect(options()).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe('No commands match “zzzz”')
  })

  it('closes with Escape, back to the document or to the field it opened from', async () => {
    const onClose = vi.fn()
    render(<Searchable onClose={onClose} />)
    await openPalette()
    fireEvent.keyDown(field(), { key: 'Escape' })
    await waitFor(() => expect(palette()).toBeNull())
    expect(onClose).toHaveBeenCalledOnce()

    const formula = screen.getByRole('textbox', { name: 'Formula' })
    await openPalette(formula)
    fireEvent.keyDown(field(), { key: 'Escape' })
    await waitFor(() => expect(palette()).toBeNull())
    expect(document.activeElement).toBe(formula)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('leaves focus where a command run from the search put it', async () => {
    const onClose = vi.fn()
    render(<Searchable onClose={onClose} />)
    await openPalette()
    fireEvent.change(field(), { target: { value: 'rename' } })
    fireEvent.click(options()[0]!)
    await waitFor(() => expect(palette()).toBeNull())
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('opens the File menu with Alt+Shift+F from inside the editor only', async () => {
    render(<Searchable />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Chat' }), fileKey)
    fireEvent.keyDown(documentBox(), { ...fileKey, shiftKey: false, key: 'f' })
    expect(openMenus()).toHaveLength(0)
    documentBox().focus()
    expect(fireEvent.keyDown(documentBox(), fileKey)).toBe(false)
    expect(await screen.findByRole('menuitem', { name: /Print/ })).toBeTruthy()
    expect(trigger('File').getAttribute('aria-expanded')).toBe('true')
    // From there the arrow keys walk the bar, as from a click.
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /Print/ }), { key: 'ArrowRight' })
    expect(await screen.findByRole('menuitem', { name: 'Text' })).toBeTruthy()
    expect(trigger('Format').getAttribute('aria-expanded')).toBe('true')
  })
})
