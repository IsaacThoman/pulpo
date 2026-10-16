// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { TrashListing } from '@pulpo/contracts'
import { TrashPage } from './TrashPage'
import { SettingsDialogProvider } from '@/components/settings/settings-dialog'
import { useFileToasts } from '@/features/files/browser/toasts'
import { FileToasts } from '@/features/files/browser/FileToasts'

vi.mock('@/stores/auth', () => ({
  useAuth: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user' }, filesEnabled: true }),
}))
const clearLocalChats = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/local-first/chat-cache', () => ({ clearLocalChats }))

const now = Date.now()
const iso = (offset: number) => new Date(now + offset).toISOString()
const node = { status: 'ready', mimeType: null, sizeBytes: 0, revision: 0, createdAt: iso(-1e9), updatedAt: iso(-1e9), systemRole: null } as const
let listing: TrashListing
const api = vi.hoisted(() => ({
  fetchTrash: vi.fn(),
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

function showTrash() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsDialogProvider controller={{ openSettings }}>
          <TrashPage />
          <FileToasts />
        </SettingsDialogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listing = {
    retention: '7d',
    files: true,
    items: [
      { ...node, id: 'file', parentId: null, kind: 'blob', name: 'report.pdf', sizeBytes: 2048, trashedAt: iso(-60_000), purgeAt: iso(7 * 86_400_000 - 60_000) },
      { ...node, id: 'chat', parentId: null, kind: 'chat', name: 'Trip plans', trashedAt: iso(-3_600_000), purgeAt: iso(2 * 86_400_000) },
    ],
  }
  api.fetchTrash.mockImplementation(async () => listing)
  useFileToasts.setState({ toasts: [] })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('trash page', () => {
  it('lists trashed chats and files together, with when each is deleted', async () => {
    showTrash()
    const list = await screen.findByRole('listbox', { name: 'Trash' })
    const rows = within(list).getAllByRole('option')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('report.pdf'),
      expect.stringContaining('Trip plans'),
    ])
    expect(rows[0]!.textContent).toContain('Deletes in 7d')
    expect(rows[1]!.textContent).toContain('Deletes in 2d')
    expect(screen.getByText(/Items are deleted forever after 7 days\./)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Change retention' }))
    expect(openSettings).toHaveBeenCalledWith('trash')
  })

  it('filters by kind', async () => {
    showTrash()
    await screen.findByRole('listbox', { name: 'Trash' })
    const chatsTab = screen.getByRole('tab', { name: 'Chats' })
    fireEvent.mouseDown(chatsTab)
    fireEvent.click(chatsTab)
    const rows = within(screen.getByRole('listbox', { name: 'Trash' })).getAllByRole('option')
    expect(rows.map((row) => row.getAttribute('data-file-id'))).toEqual(['chat'])
  })

  it('restores a chat and file together, and undoes it', async () => {
    showTrash()
    const list = await screen.findByRole('listbox', { name: 'Trash' })
    fireEvent.contextMenu(list)
    fireEvent.click(await screen.findByRole('menuitem', { name: /Select all/ }))
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Selection' })).getByRole('button', { name: 'Restore' }))
    await act(async () => undefined)
    expect(api.restoreTrashItems).toHaveBeenCalledWith(['file', 'chat'])
    const toast = await screen.findByText('Restored 2 items')
    fireEvent.click(within(toast.closest('[role="status"]')!).getByRole('button', { name: /Undo/ }))
    await act(async () => undefined)
    expect(api.retrashItems).toHaveBeenCalledWith(['file', 'chat'])
  })

  it('deletes forever after confirming, clearing the chat from this device', async () => {
    showTrash()
    const list = await screen.findByRole('listbox', { name: 'Trash' })
    fireEvent.click(within(list).getByRole('button', { name: 'Delete Trip plans forever' }))
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
})
