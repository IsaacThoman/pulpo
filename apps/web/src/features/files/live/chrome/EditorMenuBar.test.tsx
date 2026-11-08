// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorMenuBar } from './EditorMenuBar'
import type { MenuDefinition } from './menu'

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
    fireEvent.keyDown(trigger('File'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(trigger('View'))
    fireEvent.keyDown(trigger('View'), { key: 'Home' })
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
