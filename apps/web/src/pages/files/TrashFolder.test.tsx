// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { TrashFolderListing, TrashListing } from '@pulpo/contracts'
import { TrashFolderPage } from './FilesPage'
import { SettingsDialogProvider } from '@/components/settings/settings-dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useFileToasts } from '@/features/files/browser/toasts'
import { FileToasts } from '@/features/files/browser/FileToasts'

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined }),
  })
})
const auth = vi.hoisted(() => ({ filesEnabled: true }))
vi.mock('@/stores/auth', () => ({
  useAuth: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user' }, filesEnabled: auth.filesEnabled }),
}))
vi.mock('@/features/side-panel/agent', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/side-panel/agent')>(),
  usePublishFilesView: () => undefined,
}))
vi.mock('@/features/side-panel/AgentActions', () => ({ OpenChatToLeftItem: () => null, AgentMenuItems: () => null, SplitViewButton: () => null }))
vi.mock('@/features/side-panel/PanelControls', () => ({ PanelWindowButtons: () => null }))
const clearLocalChats = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/local-first/chat-cache', () => ({ clearLocalChats }))

const now = Date.now()
const iso = (offset: number) => new Date(now + offset).toISOString()
const node = { status: 'ready', mimeType: null, sizeBytes: 0, revision: 0, createdAt: iso(-1e9), updatedAt: iso(-1e9), systemRole: null } as const
let listing: TrashListing
let folderListing: TrashFolderListing
const api = vi.hoisted(() => ({
  fetchTrash: vi.fn(),
  fetchTrashFolder: vi.fn(),
  restoreTrashItems: vi.fn(async (ids: string[]) => ids.map((id) => ({ id }))),
  deleteTrashItems: vi.fn(async () => undefined),
  emptyTrash: vi.fn(async () => undefined),
  retrashItems: vi.fn(async (ids: string[]) => ids),
}))
vi.mock('@/features/trash/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/trash/api')>(),
  ...api,
}))

const openSettings = vi.fn()

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function showTrash(path = '/files/trash') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <SettingsDialogProvider controller={{ openSettings }}>
          <TooltipProvider>
            <Routes>
              <Route path="/files/trash" element={<TrashFolderPage />} />
              <Route path="/files/trash/f/:folderId" element={<TrashFolderPage />} />
              <Route path="*" element={null} />
            </Routes>
          </TooltipProvider>
          <FileToasts />
          <Location />
        </SettingsDialogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const rowsOf = (list: HTMLElement) => within(list).getAllByRole('option')

beforeEach(() => {
  auth.filesEnabled = true
  listing = {
    retention: '7d',
    files: true,
    items: [
      { ...node, id: 'file', parentId: null, kind: 'blob', name: 'report.pdf', sizeBytes: 2048, trashedAt: iso(-60_000), purgeAt: iso(7 * 86_400_000 - 60_000) },
      { ...node, id: 'chat', parentId: null, kind: 'chat', name: 'Trip plans', trashedAt: iso(-3_600_000), purgeAt: iso(2 * 86_400_000) },
      { ...node, id: 'folder', parentId: null, kind: 'folder', name: 'Old projects', trashedAt: iso(-7_200_000), purgeAt: iso(3 * 86_400_000) },
    ],
  }
  folderListing = {
    folder: listing.items[2]!,
    ancestors: [],
    children: [{ ...node, id: 'inner', parentId: 'folder', kind: 'doc', name: 'plan.md', trashedAt: iso(-7_200_000), purgeAt: iso(3 * 86_400_000) }],
    retention: '7d',
    files: true,
  }
  api.fetchTrash.mockImplementation(async () => listing)
  api.fetchTrashFolder.mockImplementation(async () => folderListing)
  useFileToasts.setState({ toasts: [] })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the trash folder', () => {
  it('lists trashed chats, files, and folders like a folder, with when each is deleted', async () => {
    showTrash()
    const list = await screen.findByRole('listbox', { name: 'Trash' })
    const rows = rowsOf(list)
    // Folders first, then newest trashed first.
    expect(rows.map((row) => row.getAttribute('data-file-id'))).toEqual(['folder', 'file', 'chat'])
    expect(rows[1]!.textContent).toContain('Deletes in 7d')
    expect(rows[2]!.textContent).toContain('Deletes in 2d')
    // Trashed folders take no drops: items are restored out of the trash, not moved within it.
    expect(rows[0]!.getAttribute('data-drop-target')).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Folder path' }).textContent).toBe('My filesTrash')
    expect(screen.getByText(/Items are deleted forever after 7 days\./)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Change retention' }))
    expect(openSettings).toHaveBeenCalledWith('trash')
  })

  it('restores the selection where it was, and undoes it', async () => {
    showTrash()
    const list = await screen.findByRole('listbox', { name: 'Trash' })
    fireEvent.contextMenu(list)
    fireEvent.click(await screen.findByRole('menuitem', { name: /Select all/ }))
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Selection' })).getByRole('button', { name: 'Restore' }))
    await act(async () => undefined)
    expect(api.restoreTrashItems).toHaveBeenCalledWith(['folder', 'file', 'chat'], undefined)
    const toast = await screen.findByText('Restored 3 items')
    fireEvent.click(within(toast.closest('[role="status"]')!).getByRole('button', { name: /Undo/ }))
    await act(async () => undefined)
    expect(api.retrashItems).toHaveBeenCalledWith(['folder', 'file', 'chat'])
  })

  it('deletes the selection forever after confirming, clearing chats from this device', async () => {
    showTrash()
    const list = await screen.findByRole('listbox', { name: 'Trash' })
    fireEvent.click(rowsOf(list)[2]!)
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(screen.getByText('"Trip plans" will be permanently deleted. This cannot be undone.')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete forever' }))
    await act(async () => undefined)
    expect(api.deleteTrashItems).toHaveBeenCalledWith(['chat'])
    expect(clearLocalChats).toHaveBeenCalledWith('user', ['chat'])
    expect(await screen.findByText('Deleted "Trip plans" forever')).toBeTruthy()
  })

  it('empties chats and files together', async () => {
    showTrash()
    await screen.findByRole('listbox', { name: 'Trash' })
    fireEvent.click(screen.getByRole('button', { name: /Empty trash/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete forever' }))
    await act(async () => undefined)
    expect(api.emptyTrash).toHaveBeenCalled()
    expect(clearLocalChats).toHaveBeenCalledWith('user', ['chat'])
  })

  it('opens trashed folders, and restores items from inside them', async () => {
    showTrash()
    const list = await screen.findByRole('listbox', { name: 'Trash' })
    fireEvent.doubleClick(rowsOf(list)[0]!)
    expect(screen.getByTestId('location').textContent).toBe('/files/trash/f/folder')
    expect(await screen.findByText('plan.md')).toBeTruthy()
    expect(api.fetchTrashFolder).toHaveBeenCalledWith('folder')
    expect(screen.getByRole('navigation', { name: 'Folder path' }).textContent).toBe('My filesTrashOld projects')
    expect(screen.getByText('This folder is in the trash.')).toBeTruthy()

    fireEvent.contextMenu(screen.getByText('plan.md'))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Restore$/ }))
    await act(async () => undefined)
    expect(api.restoreTrashItems).toHaveBeenCalledWith(['inner'], undefined)
  })

  it('brings back the trashed folder being shown, then shows it', async () => {
    showTrash('/files/trash/f/folder')
    fireEvent.click(await screen.findByRole('button', { name: /Restore folder/ }))
    await act(async () => undefined)
    expect(api.restoreTrashItems).toHaveBeenCalledWith(['folder'], undefined)
    expect(screen.getByTestId('location').textContent).toBe('/files/f/folder')
  })

  it('goes back to the trash after restoring the folder being shown with Files turned off', async () => {
    auth.filesEnabled = false
    showTrash('/files/trash/f/folder')
    fireEvent.click(await screen.findByRole('button', { name: /Restore folder/ }))
    await act(async () => undefined)
    expect(api.restoreTrashItems).toHaveBeenCalledWith(['folder'], undefined)
    expect(screen.getByTestId('location').textContent).toBe('/files/trash')
  })

  it('goes back to the trash after emptying it from inside a trashed folder', async () => {
    showTrash('/files/trash/f/folder')
    await screen.findByText('plan.md')
    fireEvent.click(screen.getByRole('button', { name: /Empty trash/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete forever' }))
    await act(async () => undefined)
    expect(api.emptyTrash).toHaveBeenCalled()
    expect(screen.getByTestId('location').textContent).toBe('/files/trash')
  })

  it('does not open trashed files', async () => {
    showTrash()
    const list = await screen.findByRole('listbox', { name: 'Trash' })
    fireEvent.doubleClick(rowsOf(list)[1]!)
    expect(screen.getByTestId('location').textContent).toBe('/files/trash')
    expect(await screen.findByText('"report.pdf" is in the trash. Restore it to open it.')).toBeTruthy()
  })

  it('still works with Files turned off', async () => {
    auth.filesEnabled = false
    listing = { ...listing, files: false, items: listing.items.filter((item) => item.kind !== 'blob') }
    showTrash()
    const list = await screen.findByRole('listbox', { name: 'Trash' })
    expect(rowsOf(list).map((row) => row.getAttribute('data-file-id'))).toEqual(['folder', 'chat'])
    expect(screen.getByRole('navigation', { name: 'Folder path' }).textContent).toBe('Trash')
    // There is no Files picker to restore into.
    fireEvent.contextMenu(rowsOf(list)[0]!)
    await screen.findByRole('menuitem', { name: /^Restore$/ })
    expect(screen.queryByRole('menuitem', { name: /Restore to/ })).toBeNull()
  })
})
