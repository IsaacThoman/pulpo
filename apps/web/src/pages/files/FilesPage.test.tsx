// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { FilesPage, FolderPanelView } from './FilesPage'
import { useSettings, type FileDoubleClickAction } from '@/stores/settings'
import { useSidePanel } from '@/features/side-panel/store'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined }),
  })
})
vi.mock('@/stores/auth', () => ({
  useAuth: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user' }, filesEnabled: true }),
}))
vi.mock('@/features/side-panel/agent', () => ({ usePublishFilesView: () => undefined }))
vi.mock('@/features/side-panel/AgentActions', () => ({ AgentMenuItems: () => null, SplitViewButton: () => null }))
vi.mock('@/features/side-panel/PanelControls', () => ({ PanelWindowButtons: () => null }))
vi.mock('@/features/files/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/files/api')>(),
  fetchFolder: async () => ({ folder: null, ancestors: [], children: [
    { id: 'document', name: 'Notes.md', kind: 'doc', sizeBytes: 0, updatedAt: '2026-10-06T00:00:00Z' },
    { id: 'folder', name: 'Projects', kind: 'folder', updatedAt: '2026-10-06T00:00:00Z' },
    { id: 'sidebar', name: 'Sidebar', kind: 'folder', systemRole: 'chats', updatedAt: '2026-10-06T00:00:00Z' },
    { id: 'plans', name: 'Plans.md', kind: 'doc', sizeBytes: 0, pinned: true, updatedAt: '2026-10-06T00:00:00Z' },
  ] }),
  fetchFolderLayout: async () => ({ folderId: null, positions: {}, snapToGrid: true }),
}))

const pinSidebarItems = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/features/sidebar/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/sidebar/api')>(),
  pinSidebarItems,
}))

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function showFiles(panel = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/files']}>
        <TooltipProvider>
          {panel ? <FolderPanelView folderId={null} /> : <FilesPage />}
        </TooltipProvider>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  useSettings.setState({ fileDoubleClickAction: 'open' })
  useSidePanel.setState({ content: null, lastContent: null, splitAvailable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

async function doubleClick(name: string, ctrlKey = false) {
  const item = await screen.findByRole('option', { name: new RegExp(name) })
  // Include both selection clicks, so a modifier double-click still selects the opened file.
  fireEvent.click(item, { ctrlKey, detail: 1 })
  fireEvent.click(item, { ctrlKey, detail: 2 })
  fireEvent.doubleClick(item, { ctrlKey })
  return item
}

describe.each(['list', 'grid'])('file double-click in %s view', (view) => {
  const cases: [FileDoubleClickAction, boolean, boolean][] = [
    ['open', false, false],
    ['open', true, true],
    ['openBeside', false, true],
    ['openBeside', true, false],
  ]

  it.each(cases)('setting %s with Ctrl=%s opens beside=%s', async (action, modifier, beside) => {
    localStorage.setItem('pulpo.files.view', view)
    useSettings.setState({ fileDoubleClickAction: action })
    showFiles()
    const item = await doubleClick('Notes.md', modifier)
    expect(item.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('location').textContent).toBe(beside ? '/files' : '/files/d/document')
    expect(useSidePanel.getState().content).toEqual(beside ? { kind: 'file', id: 'document' } : null)
  })

  it.each(cases)('setting %s with Ctrl=%s opens in place when a split cannot fit', async (action, modifier) => {
    localStorage.setItem('pulpo.files.view', view)
    useSettings.setState({ fileDoubleClickAction: action })
    useSidePanel.setState({ splitAvailable: false })
    showFiles()
    await doubleClick('Notes.md', modifier)
    expect(screen.getByTestId('location').textContent).toBe('/files/d/document')
    expect(useSidePanel.getState().content).toBeNull()
  })

  it.each(cases)('setting %s with Ctrl=%s keeps panel behavior', async (action, modifier) => {
    localStorage.setItem('pulpo.files.view', view)
    useSettings.setState({ fileDoubleClickAction: action })
    useSidePanel.setState({ content: { kind: 'folder', id: null } })
    showFiles(true)
    await doubleClick('Notes.md', modifier)
    expect(screen.getByTestId('location').textContent).toBe(modifier ? '/files/d/document' : '/files')
    expect(useSidePanel.getState().content).toEqual(modifier ? null : { kind: 'file', id: 'document' })
  })

  it.each(cases)('setting %s with Ctrl=%s browses folders in place', async (action, modifier) => {
    localStorage.setItem('pulpo.files.view', view)
    useSettings.setState({ fileDoubleClickAction: action })
    showFiles()
    await doubleClick('Projects', modifier)
    expect(screen.getByTestId('location').textContent).toBe('/files/f/folder')
    expect(useSidePanel.getState().content).toBeNull()
  })
})

it('applies a changed preference to an already open browser', async () => {
  showFiles()
  await screen.findByRole('option', { name: /Notes.md/ })
  act(() => useSettings.getState().set('fileDoubleClickAction', 'openBeside'))
  await doubleClick('Notes.md')
  expect(screen.getByTestId('location').textContent).toBe('/files')
  expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: 'document' })
})

describe('menus of built-in folders', () => {
  const unavailable = ['Pin', 'Rename', 'Color and icon…', 'Move to…', 'Cut', 'Move to trash']
  // Menu items' names end with their keyboard shortcut.
  const menuItem = (name: string) => screen.getByRole('menuitem', { name: new RegExp(`^${name}`) })

  it('lists the actions they do not allow, unavailable', async () => {
    showFiles()
    fireEvent.contextMenu(await screen.findByRole('option', { name: /Sidebar/ }))
    await screen.findByRole('menuitem', { name: /^Copy/ })
    for (const name of unavailable) expect(menuItem(name).getAttribute('aria-disabled')).toBe('true')
    expect(menuItem('Copy').getAttribute('aria-disabled')).toBeNull()
  })

  it('leaves the same actions available for other folders', async () => {
    showFiles()
    fireEvent.contextMenu(await screen.findByRole('option', { name: /Projects/ }))
    await screen.findByRole('menuitem', { name: /^Copy/ })
    for (const name of unavailable) expect(menuItem(name).getAttribute('aria-disabled')).toBeNull()
  })
})

describe('pinning', () => {
  it('marks pinned items, and pins or unpins the selection from its menu', async () => {
    showFiles()
    const plans = await screen.findByRole('option', { name: /Plans.md/ })
    expect(plans.querySelector('[aria-label="Pinned to the sidebar"]')).toBeTruthy()
    expect((await screen.findByRole('option', { name: /Notes.md/ })).querySelector('[aria-label="Pinned to the sidebar"]')).toBeNull()

    fireEvent.contextMenu(plans)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unpin' }))
    expect(pinSidebarItems).toHaveBeenCalledWith(['plans'], false, [expect.objectContaining({ id: 'plans' })])

    fireEvent.contextMenu(await screen.findByRole('option', { name: /Notes.md/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin' }))
    expect(pinSidebarItems).toHaveBeenCalledWith(['document'], true, [expect.objectContaining({ id: 'document' })])
  })
})
