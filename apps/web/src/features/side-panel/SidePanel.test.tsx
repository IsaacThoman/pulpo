// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidePanel } from './SidePanel'
import { useSidePanel } from './store'

const runAgentShortcut = vi.hoisted(() => vi.fn())
vi.mock('./agent', () => ({ runAgentShortcut }))
vi.mock('@/pages/files/FileDocPage', () => ({ FilePanelView: () => null }))
vi.mock('@/pages/files/FilesPage', () => ({ FolderPanelView: () => null }))

function Path() {
  return <output aria-label="Path">{useLocation().pathname}</output>
}

function mount() {
  return render(<MemoryRouter initialEntries={['/c/chat']}>
    <Routes><Route path="*" element={<>
      <div data-file-editor="document"><div role="textbox" tabIndex={0} aria-label="Document body" /></div>
      <div data-file-editor="text"><div role="textbox" tabIndex={0} aria-label="Code" /></div>
      <div data-file-editor="sheet"><textarea aria-label="Sheet grid" /></div>
      <div data-file-editor="presentation"><div role="application" tabIndex={0} aria-label="Slide" /></div>
      <textarea aria-label="Composer" />
      <SidePanel available={1600} />
      <Path />
    </>} /></Routes>
  </MemoryRouter>)
}

const handled = (event: Event) => event.preventDefault()

beforeEach(() => {
  runAgentShortcut.mockClear()
  useSidePanel.setState({ content: null, lastContent: { kind: 'file', id: 'plan' }, splitAvailable: true })
})
afterEach(cleanup)

describe('side panel shortcuts', () => {
  it('toggles the panel with Cmd/Ctrl+Backslash, except inside an editor or once handled', () => {
    mount()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Document body' }), { key: '\\', metaKey: true })
    expect(useSidePanel.getState().content).toBeNull()
    const composer = screen.getByRole('textbox', { name: 'Composer' })
    composer.addEventListener('keydown', handled)
    fireEvent.keyDown(composer, { key: '\\', ctrlKey: true })
    composer.removeEventListener('keydown', handled)
    expect(useSidePanel.getState().content).toBeNull()
    fireEvent.keyDown(composer, { key: '\\', ctrlKey: true })
    expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: 'plan' })
  })

  it('leaves Cmd/Ctrl+J to an editor (Justify) and runs the agent shortcut elsewhere', async () => {
    mount()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Document body' }), { key: 'j', metaKey: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runAgentShortcut).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Composer' }), { key: 'j', metaKey: true })
    await vi.waitFor(() => expect(runAgentShortcut).toHaveBeenCalledTimes(1))
  })

  it('keeps its keys in code and notebook editors, which do not format text with them', async () => {
    mount()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Code' }), { key: 'j', metaKey: true })
    await vi.waitFor(() => expect(runAgentShortcut).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Code' }), { key: '\\', ctrlKey: true })
    expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: 'plan' })
  })

  it('asks the agent from spreadsheets and presentations, which bind no Cmd/Ctrl+J, and leaves them Clear formatting', async () => {
    mount()
    expect(fireEvent.keyDown(screen.getByRole('textbox', { name: 'Sheet grid' }), { key: 'j', ctrlKey: true })).toBe(false)
    await vi.waitFor(() => expect(runAgentShortcut).toHaveBeenCalledTimes(1))
    expect(fireEvent.keyDown(screen.getByRole('application', { name: 'Slide' }), { key: 'j', metaKey: true })).toBe(false)
    await vi.waitFor(() => expect(runAgentShortcut).toHaveBeenCalledTimes(2))
    // Cmd/Ctrl+Backslash clears formatting there, so the panel stays as it is.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Sheet grid' }), { key: '\\', ctrlKey: true })
    fireEvent.keyDown(screen.getByRole('application', { name: 'Slide' }), { key: '\\', ctrlKey: true })
    expect(useSidePanel.getState().content).toBeNull()
  })

  it("claims a document's Cmd/Ctrl+J where the editor left it alone (read-only), so the browser's Downloads never opens", () => {
    mount()
    // Ctrl is the primary modifier here (not a Mac).
    expect(fireEvent.keyDown(screen.getByRole('textbox', { name: 'Document body' }), { key: 'j', ctrlKey: true })).toBe(false)
    expect(runAgentShortcut).not.toHaveBeenCalled()
  })

  it('moves the panel to the main view with Cmd/Ctrl+Shift+Enter unless an editor used the key', () => {
    useSidePanel.getState().open({ kind: 'folder', id: null })
    mount()
    const body = screen.getByRole('textbox', { name: 'Document body' })
    body.addEventListener('keydown', handled)
    fireEvent.keyDown(body, { key: 'Enter', metaKey: true, shiftKey: true })
    body.removeEventListener('keydown', handled)
    expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: null })
    expect(screen.getByRole('status', { name: 'Path' }).textContent).toBe('/c/chat')
    fireEvent.keyDown(body, { key: 'Enter', metaKey: true, shiftKey: true })
    expect(useSidePanel.getState().content).toBeNull()
    expect(screen.getByRole('status', { name: 'Path' }).textContent).toBe('/files')
  })
})
