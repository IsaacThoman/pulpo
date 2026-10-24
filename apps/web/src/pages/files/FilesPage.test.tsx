// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { FilesPage, FolderPanelView } from './FilesPage'
import { useSettings, type FileDoubleClickAction } from '@/stores/settings'
import { useSidePanel } from '@/features/side-panel/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useFileClipboard } from '@/features/files/browser/clipboard'
import { ApiError } from '@/lib/api'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined }),
  })
})
const authState = vi.hoisted(() => ({ user: { id: 'user' }, filesEnabled: true, urlImportEnabled: false }))
vi.mock('@/stores/auth', () => ({
  useAuth: (selector: (state: unknown) => unknown) => selector(authState),
}))
vi.mock('@/features/side-panel/agent', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/side-panel/agent')>(),
  usePublishFilesView: () => undefined,
}))
vi.mock('@/features/side-panel/AgentActions', async (importOriginal) => ({
  OpenChatToLeftItem: (await importOriginal<typeof import('@/features/side-panel/AgentActions')>()).OpenChatToLeftItem,
  AgentMenuItems: () => null,
  SplitViewButton: () => null,
}))
vi.mock('@/features/side-panel/PanelControls', () => ({ PanelWindowButtons: () => null }))
const resolveFileSuggestion = vi.hoisted(() => vi.fn(async () => null))
const importFromUrl = vi.hoisted(() => vi.fn())
vi.mock('@/features/files/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/files/api')>(),
  resolveFileSuggestion,
  importFromUrl,
  fetchFolder: async (folderId: string | null) => folderId === 'plan-drafts' ? {
    // A folder inside the suggested folder Plan, holding more of the same suggestion.
    folder: { id: 'plan-drafts', parentId: 'plan', name: 'Drafts', kind: 'folder', updatedAt: '2026-10-06T00:00:00Z', suggestion: { changeId: 'plan-change' } },
    ancestors: [
      { id: 'projects', parentId: null, name: 'Projects', kind: 'folder', updatedAt: '2026-10-06T00:00:00Z' },
      { id: 'plan', parentId: 'projects', name: 'Plan', kind: 'folder', updatedAt: '2026-10-06T00:00:00Z', suggestion: { changeId: 'plan-change' } },
    ],
    children: [{ id: 'plan-notes', parentId: 'plan-drafts', name: 'notes.md', kind: 'doc', sizeBytes: 0, updatedAt: '2026-10-06T00:00:00Z', suggestion: { changeId: 'plan-change' } }],
  } : { folder: null, ancestors: [], children: [
    { id: 'document', name: 'Notes.md', kind: 'doc', sizeBytes: 0, updatedAt: '2026-10-06T00:00:00Z' },
    { id: 'folder', name: 'Projects', kind: 'folder', updatedAt: '2026-10-06T00:00:00Z' },
    { id: 'sidebar', name: 'Sidebar', kind: 'folder', systemRole: 'chats', updatedAt: '2026-10-06T00:00:00Z' },
    { id: 'suggested', name: 'Draft.md', kind: 'doc', sizeBytes: 0, updatedAt: '2026-10-06T00:00:00Z', suggestion: { changeId: 'change' } },
    { id: 'plans', name: 'Plans.md', kind: 'doc', sizeBytes: 0, pinned: true, updatedAt: '2026-10-06T00:00:00Z' },
    { id: 'trip', name: 'Trip', kind: 'chat', sizeBytes: 0, updatedAt: '2026-10-06T00:00:00Z' },
  ] },
  fetchFolderLayout: async () => ({ folderId: null, positions: {}, snapToGrid: true }),
}))

const pinSidebarItems = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/features/sidebar/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/sidebar/api')>(),
  pinSidebarItems,
}))

const chatActions = vi.hoisted(() => ({ duplicateChats: vi.fn(async () => []), copyChatShareLink: vi.fn(async () => undefined) }))
vi.mock('@/features/chat/chat-actions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/chat/chat-actions')>(),
  ...chatActions,
}))

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function showFiles(panel = false, folderId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/files']}>
        <TooltipProvider>
          {panel ? <FolderPanelView folderId={folderId} /> : <FilesPage />}
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); authState.urlImportEnabled = false })

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
  const unavailable = ['Pin', 'Rename', 'Move to…', 'Cut', 'Move to trash']
  // Menu items' names end with their keyboard shortcut.
  const menuItem = (name: string) => screen.getByRole('menuitem', { name: new RegExp(`^${name}`) })

  it('lists the actions they do not allow, unavailable, and can be given only a color', async () => {
    showFiles()
    fireEvent.contextMenu(await screen.findByRole('option', { name: /Sidebar/ }))
    await screen.findByRole('menuitem', { name: /^Copy/ })
    for (const name of unavailable) expect(menuItem(name).getAttribute('aria-disabled')).toBe('true')
    expect(menuItem('Copy').getAttribute('aria-disabled')).toBeNull()
    expect(menuItem('Color…').getAttribute('aria-disabled')).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^Color and icon/ })).toBeNull()
  })

  it('leaves the same actions available for other folders', async () => {
    showFiles()
    fireEvent.contextMenu(await screen.findByRole('option', { name: /Projects/ }))
    await screen.findByRole('menuitem', { name: /^Copy/ })
    for (const name of [...unavailable, 'Color and icon…']) expect(menuItem(name).getAttribute('aria-disabled')).toBeNull()
  })
})

describe('importing from a URL', () => {
  const openNewMenu = async () => {
    await screen.findByRole('option', { name: /Notes.md/ })
    fireEvent.keyDown(screen.getByRole('button', { name: 'New' }), { key: 'Enter' })
    await screen.findByRole('menuitem', { name: 'Upload files' })
  }
  const importPage = async (address: string) => {
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import from URL' }))
    fireEvent.change(await screen.findByLabelText('Web address'), { target: { value: address } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import' })) })
  }

  it('is offered only when the server can fetch pages', async () => {
    showFiles()
    await openNewMenu()
    expect(screen.queryByRole('menuitem', { name: 'Import from URL' })).toBeNull()
  })

  it('saves the page in the open folder and selects it', async () => {
    authState.urlImportEnabled = true
    importFromUrl.mockResolvedValue({ id: 'imported', parentId: null, name: 'Article.md', kind: 'doc', sizeBytes: 10, updatedAt: '2026-10-06T00:00:00Z' })
    showFiles()
    await openNewMenu()
    await importPage('example.com/article')
    expect(importFromUrl).toHaveBeenCalledWith(null, 'https://example.com/article')
    expect((await screen.findByRole('option', { name: /Article.md/ })).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the address and explains when the page cannot be imported', async () => {
    authState.urlImportEnabled = true
    importFromUrl.mockRejectedValue(new ApiError(502, 'url_import_failed', 'upstream'))
    showFiles()
    await openNewMenu()
    await importPage('https://example.com/missing')
    expect(await screen.findByText('This page could not be imported. Check the link and try again.')).toBeTruthy()
    expect((screen.getByLabelText('Web address') as HTMLInputElement).value).toBe('https://example.com/missing')
  })
})

describe('the trash in My files', () => {
  const menuItem = (name: string) => screen.getByRole('menuitem', { name: new RegExp(`^${name}`) })

  it('is a built-in folder that takes dropped items and opens the trash', async () => {
    showFiles()
    const trash = await screen.findByRole('option', { name: /^Trash/ })
    expect(trash.getAttribute('data-drop-target')).toBe('trash')
    fireEvent.contextMenu(trash)
    await screen.findByRole('menuitem', { name: /^Rename/ })
    for (const name of ['Pin', 'Rename', 'Move to…', 'Cut', 'Move to trash']) {
      expect(menuItem(name).getAttribute('aria-disabled')).toBe('true')
    }
    expect(menuItem('Color…').getAttribute('aria-disabled')).toBeNull()
    // It is not stored in Files, so there is nothing to copy or duplicate.
    expect(screen.queryByRole('menuitem', { name: /^Copy/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^Duplicate/ })).toBeNull()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await doubleClick('Trash')
    expect(screen.getByTestId('location').textContent).toBe('/files/trash')
  })

  it('is left out when everything is selected and copied', async () => {
    showFiles()
    await screen.findByRole('option', { name: /^Trash/ })
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    const copied = useFileClipboard.getState().clip?.nodes.map((node) => node.id) ?? []
    expect(copied).toContain('document')
    expect(copied).not.toContain('trash')
    // Selected with a file, the trash leaves Copy and Duplicate available for it.
    fireEvent.click(screen.getByRole('option', { name: /Notes.md/ }))
    fireEvent.click(screen.getByRole('option', { name: /^Trash/ }), { ctrlKey: true })
    fireEvent.contextMenu(screen.getByRole('option', { name: /Notes.md/ }))
    expect((await screen.findByRole('menuitem', { name: /^Copy/ })).getAttribute('aria-disabled')).toBeNull()
    expect(screen.getByRole('menuitem', { name: /^Duplicate/ })).toBeTruthy()
  })

  it('opens in the panel like any folder', async () => {
    useSidePanel.setState({ content: { kind: 'folder', id: null } })
    showFiles(true)
    await doubleClick('Trash')
    expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: 'trash' })
  })
})

describe('items an agent suggested', () => {
  it.each(['list', 'grid'])('are marked in %s view and can be accepted or rejected from their menu', async (view) => {
    localStorage.setItem('pulpo.files.view', view)
    showFiles()
    const item = await screen.findByRole('option', { name: /Draft\.md/ })
    expect(item.textContent).toContain('Suggested')
    expect((await screen.findByRole('option', { name: /Notes\.md/ })).textContent).not.toContain('Suggested')
    fireEvent.contextMenu(item)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reject suggestion' }))
    await vi.waitFor(() => expect(resolveFileSuggestion).toHaveBeenCalledWith('suggested', 'reject'))
    fireEvent.contextMenu(await screen.findByRole('option', { name: /Notes\.md/ }))
    await screen.findByRole('menuitem', { name: /^Copy/ })
    expect(screen.queryByRole('menuitem', { name: 'Accept suggestion' })).toBeNull()
  })
})

describe('inside a folder an agent suggested', () => {
  it('reviews the folder as a whole and then shows the folder that held it', async () => {
    useSidePanel.setState({ content: { kind: 'folder', id: 'plan-drafts' } })
    showFiles(true, 'plan-drafts')
    const item = await screen.findByRole('option', { name: /notes\.md/ })
    fireEvent.contextMenu(item)
    await screen.findByRole('menuitem', { name: /^Copy/ })
    expect(screen.queryByRole('menuitem', { name: 'Reject suggestion' })).toBeNull()

    expect(screen.getByText(/part of the folder “Plan” an agent suggested/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reject folder' }))
    await vi.waitFor(() => expect(resolveFileSuggestion).toHaveBeenCalledWith('plan', 'reject'))
    await vi.waitFor(() => expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: 'projects' }))
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

describe('chats in Files', () => {
  it('offers what the chat menu does: a share link and duplicating', async () => {
    showFiles()
    fireEvent.contextMenu(await screen.findByRole('option', { name: /Trip/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy share link' }))
    expect(chatActions.copyChatShareLink).toHaveBeenCalledWith('trip')

    fireEvent.contextMenu(await screen.findByRole('option', { name: /Trip/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Duplicate/ }))
    expect(chatActions.duplicateChats).toHaveBeenCalledWith([{ id: 'trip', title: 'Trip' }])
  })

  it('opens a chat to the left from its menu, moving the folder into the panel', async () => {
    showFiles()
    fireEvent.contextMenu(await screen.findByRole('option', { name: /Trip/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Open to the left/ }))
    expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: null })
    expect(screen.getByTestId('location').textContent).toBe('/c/trip')
  })

  it('opens a chat to the left with Alt-click', async () => {
    showFiles()
    fireEvent.click(await screen.findByRole('option', { name: /Trip/ }), { altKey: true })
    expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: null })
    expect(screen.getByTestId('location').textContent).toBe('/c/trip')
  })

  it('leaves a chat in the panel to Open, which already shows it to the left', async () => {
    useSidePanel.setState({ content: { kind: 'folder', id: null } })
    showFiles(true)
    fireEvent.contextMenu(await screen.findByRole('option', { name: /Trip/ }))
    expect(await screen.findByRole('menuitem', { name: 'Copy share link' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /^Open to the left/ })).toBeNull()
  })

  it('calls trashing a chat deleting it when trashed chats are deleted right away', async () => {
    useSettings.setState({ trashRetention: 'instant' })
    showFiles()
    fireEvent.contextMenu(await screen.findByRole('option', { name: /Trip/ }))
    expect(await screen.findByRole('menuitem', { name: /^Delete/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /^Move to trash/ })).toBeNull()
    useSettings.setState({ trashRetention: '30d' })
  })
})
