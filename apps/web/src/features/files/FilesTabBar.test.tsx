// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { FileNode } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuth } from '@/stores/auth'
import { FilesTabBar } from './FilesTabBar'
import { useFilesTabs } from './tabs'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
const notes: FileNode = {
  id: '00000000-0000-4000-8000-0000000000a1', parentId: null, kind: 'doc', name: 'Notes.md', status: 'ready',
  mimeType: 'text/markdown', sizeBytes: 1, revision: 0, trashedAt: null, createdAt: '', updatedAt: '',
}
const projects: FileNode = { ...notes, id: '00000000-0000-4000-8000-0000000000b2', kind: 'folder', name: 'Projects', mimeType: null }
vi.mock('./api', async (actual) => ({
  ...await actual<object>(),
  fetchFileNode: async (id: string) => ({ node: id === notes.id ? notes : projects, ancestors: [] }),
}))

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function renderBar() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/files']}>
        <TooltipProvider>
          <FilesTabBar />
        </TooltipProvider>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const location = () => screen.getByTestId('location').textContent
const tabNames = () => screen.getAllByRole('tab').map((tab) => `${tab.textContent}${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}`)

beforeEach(() => {
  localStorage.clear()
  useAuth.setState({ user: { id: 'user' } } as never)
  useFilesTabs.setState({
    userId: 'user',
    tabs: [
      { id: 'home', content: { kind: 'folder', id: null } },
      { id: 'notes', content: { kind: 'file', id: notes.id } },
      { id: 'projects', content: { kind: 'folder', id: projects.id } },
    ],
    activeId: 'home',
  }, true)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Files tab bar', () => {
  it('names each tab after what it shows and switches to one when clicked', async () => {
    renderBar()
    await screen.findByText('Projects')
    expect(tabNames()).toEqual(['My files*', 'Notes.md', 'Projects'])
    fireEvent.click(screen.getByRole('tab', { name: 'Notes.md' }))
    expect(location()).toBe(`/files/d/${notes.id}`)
    expect(tabNames()).toEqual(['My files', 'Notes.md*', 'Projects'])
    // Arrow keys move between tabs.
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Notes.md' }), { key: 'ArrowRight' })
    expect(location()).toBe(`/files/f/${projects.id}`)
  })

  it('shows the tab to the right when the active tab closes, and hides the bar at one tab', async () => {
    useFilesTabs.setState({ activeId: 'notes' })
    renderBar()
    await screen.findByText('Notes.md')
    fireEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[1]!)
    expect(location()).toBe(`/files/f/${projects.id}`)
    expect(tabNames()).toEqual(['My files', 'Projects*'])
    // A background tab closes without moving the view; middle-click closes too.
    fireEvent(screen.getByRole('tab', { name: 'My files' }), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(location()).toBe(`/files/f/${projects.id}`)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('closes other tabs from a tab’s menu, and opens My files in a new tab', async () => {
    renderBar()
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'My files' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Close other tabs' }))
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(useFilesTabs.getState().tabs.map((tab) => tab.id)).toEqual(['home'])

    useFilesTabs.setState({ tabs: [...useFilesTabs.getState().tabs, { id: 'notes', content: { kind: 'file', id: notes.id } }], activeId: 'notes' })
    fireEvent.click(await screen.findByRole('button', { name: 'New tab' }))
    expect(location()).toBe('/files')
    expect(useFilesTabs.getState().tabs.map((tab) => tab.content)).toEqual([
      { kind: 'folder', id: null },
      { kind: 'file', id: notes.id },
      { kind: 'folder', id: null },
    ])
  })
})
