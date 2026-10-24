// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { FileNode } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuth } from '@/stores/auth'
import { useMainTabs } from './main-tabs'
import { MainTabsLayout, PanelTabStrip } from './PanelControls'
import { useSidePanel } from './store'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
const notes: FileNode = {
  id: '00000000-0000-4000-8000-0000000000a1', parentId: null, kind: 'doc', name: 'Notes.md', status: 'ready',
  mimeType: 'text/markdown', sizeBytes: 1, revision: 0, trashedAt: null, createdAt: '', updatedAt: '',
}
const projects: FileNode = { ...notes, id: '00000000-0000-4000-8000-0000000000b2', kind: 'folder', name: 'Projects', mimeType: null }
vi.mock('@/features/files/api', async (actual) => ({
  ...await actual<object>(),
  fetchFileNode: async (id: string) => ({ node: id === notes.id ? notes : projects, ancestors: [] }),
}))

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function renderWith(ui: React.ReactNode, path = '/') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <TooltipProvider>{ui}</TooltipProvider>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const location = () => screen.getByTestId('location').textContent
const tabNames = () => screen.getAllByRole('tab').map((tab) => `${tab.textContent}${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}`)
const home = { kind: 'folder', id: null } as const
const notesTab = { kind: 'file', id: notes.id } as const
const projectsTab = { kind: 'folder', id: projects.id } as const

beforeEach(() => {
  localStorage.clear()
  useAuth.setState({ user: { id: 'user' } } as never)
  useSidePanel.setState({ tabs: [], activeId: null, content: null, hidden: false, closed: { tabs: [], activeId: null }, userId: null, splitAvailable: true })
  useMainTabs.setState({ userId: 'user', tabs: [], activeId: null }, true)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('side panel tabs', () => {
  beforeEach(() => {
    useSidePanel.getState().open(home)
    useSidePanel.getState().open(notesTab)
  })

  it('names each tab after what it shows and switches on click or with the arrow keys', async () => {
    renderWith(<PanelTabStrip />)
    await screen.findByText('Notes.md')
    expect(tabNames()).toEqual(['My files', 'Notes.md*'])
    fireEvent.click(screen.getByRole('tab', { name: 'My files' }))
    expect(useSidePanel.getState().content).toEqual(home)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'My files' }), { key: 'ArrowRight' })
    expect(useSidePanel.getState().content).toEqual(notesTab)
  })

  it('opens My files in a new tab, and closes the panel with its last tab', async () => {
    renderWith(<PanelTabStrip />)
    await screen.findByText('Notes.md')
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    expect(tabNames()).toEqual(['My files', 'Notes.md', 'My files*'])
    for (const button of screen.getAllByRole('button', { name: 'Close tab' }).reverse()) fireEvent.click(button)
    expect(useSidePanel.getState().content).toBeNull()
  })

  it('moves the active tab to the main view, where it gets a tab of its own', async () => {
    renderWith(<PanelTabStrip />, '/c/chat')
    fireEvent.click(screen.getByRole('button', { name: /^Open in main view/ }))
    expect(location()).toBe(`/files/d/${notes.id}`)
    expect(useSidePanel.getState().tabs.map((tab) => tab.content)).toEqual([home])
    expect(useMainTabs.getState().tabs.map((tab) => tab.content)).toEqual([notesTab])
  })
})

describe('main view tabs', () => {
  const layout = (
    <Routes>
      <Route element={<MainTabsLayout />}>
        <Route path="files" element={<p>My files view</p>} />
        <Route path="files/f/:id" element={<p>Folder view</p>} />
        <Route path="files/d/:id" element={<p>File view</p>} />
      </Route>
    </Routes>
  )

  beforeEach(() => {
    useMainTabs.setState({
      userId: 'user',
      tabs: [{ id: 'home', content: home }, { id: 'notes', content: notesTab }, { id: 'projects', content: projectsTab }],
      activeId: 'notes',
    }, true)
  })

  it('switches tabs, and shows the tab to the right when the active one closes', async () => {
    renderWith(layout, `/files/d/${notes.id}`)
    await screen.findByText('Projects')
    expect(tabNames()).toEqual(['My files', 'Notes.md*', 'Projects'])
    fireEvent.click(screen.getByRole('tab', { name: 'My files' }))
    expect(location()).toBe('/files')
    fireEvent.click(screen.getByRole('tab', { name: 'Notes.md' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[1]!)
    expect(location()).toBe(`/files/f/${projects.id}`)
    expect(tabNames()).toEqual(['My files', 'Projects*'])
  })

  it('keeps its last tab, and moves a tab to the side panel from its menu', async () => {
    renderWith(layout, `/files/d/${notes.id}`)
    fireEvent.contextMenu(await screen.findByRole('tab', { name: 'Notes.md' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Move to side panel/ }))
    expect(useSidePanel.getState().content).toEqual(notesTab)
    expect(location()).toBe(`/files/f/${projects.id}`)
    fireEvent(screen.getByRole('tab', { name: 'Projects' }), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Close tab' })).toBeNull()
  })
})
