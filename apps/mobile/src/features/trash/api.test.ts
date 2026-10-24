// @vitest-environment node
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())
const stored = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../../api/client', async () => {
  class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message) }
  }
  return { ApiError, apiRequest: request, isNetworkError: (error: unknown) => error instanceof TypeError }
})
vi.mock('../../data/database', () => ({
  getValue: async (namespace: string, key: string) => stored.get(`${namespace}/${key}`) ?? null,
  setValue: async (namespace: string, key: string, value: unknown) => { stored.set(`${namespace}/${key}`, value) },
}))

const { legacyTrashView, restoreTrashItems, trashDeletesLabel, trashItemSubtitle, trashQuery, trashRetentionSummary } = await import('./api')
const { ApiError } = await import('../../api/client')

const fetchView = (folderId: string | null) => new QueryClient().fetchQuery(trashQuery('ns', folderId))

describe('the trash', () => {
  beforeEach(() => {
    request.mockReset()
    stored.clear()
  })

  it('lists the trash, chats included, and trashed folders', async () => {
    request.mockResolvedValueOnce({ retention: '30d', files: true, items: [{ id: 'chat', kind: 'chat' }, { id: 'folder', kind: 'folder' }] })
    expect(await fetchView(null)).toEqual({ folder: null, ancestors: [], children: [{ id: 'chat', kind: 'chat' }, { id: 'folder', kind: 'folder' }], retention: '30d', files: true })
    expect(request).toHaveBeenLastCalledWith('/api/trash', expect.anything())
    const folder = { folder: { id: 'folder' }, ancestors: [], children: [], retention: '30d', files: true }
    request.mockResolvedValueOnce(folder)
    expect(await fetchView('folder')).toEqual(folder)
    expect(request).toHaveBeenLastCalledWith('/api/trash/folders/folder', expect.anything())
  })

  it('shows the last copy offline, and nothing from servers without the shared trash', async () => {
    request.mockResolvedValueOnce({ retention: '7d', files: true, items: [] })
    await fetchView(null)
    request.mockRejectedValueOnce(new TypeError('Network request failed'))
    expect(await fetchView(null)).toMatchObject({ retention: '7d', offline: true })
    request.mockRejectedValueOnce(new ApiError(404, 'not_found', 'Route not found'))
    expect(await fetchView(null)).toBeNull()
    request.mockRejectedValueOnce(new ApiError(500, 'server_error', 'Boom'))
    await expect(fetchView(null)).rejects.toMatchObject({ status: 500 })
  })

  it('restores items where they were or into a folder', async () => {
    request.mockResolvedValue({ items: [] })
    await restoreTrashItems(['a'])
    expect(request).toHaveBeenLastCalledWith('/api/trash/restore', { method: 'POST', body: { ids: ['a'] } })
    await restoreTrashItems(['a'], { parentId: null })
    expect(request).toHaveBeenLastCalledWith('/api/trash/restore', { method: 'POST', body: { ids: ['a'], parentId: null } })
  })

  it('lists the chat store’s trashed chats on older servers', () => {
    const view = legacyTrashView([
      { id: 'kept', title: 'Kept', createdAt: 0, updatedAt: 0, deletedAt: null, purgeAt: null },
      { id: 'gone', title: 'Gone', createdAt: 0, updatedAt: 0, deletedAt: Date.parse('2026-01-01T00:00:00Z'), purgeAt: Date.parse('2026-01-08T00:00:00Z') },
    ], '7d')
    expect(view.files).toBe(false)
    expect(view.children).toEqual([expect.objectContaining({ id: 'gone', kind: 'chat', name: 'Gone', trashedAt: '2026-01-01T00:00:00.000Z', purgeAt: '2026-01-08T00:00:00.000Z' })])
  })

  it('describes when items are deleted', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(trashDeletesLabel(null, now)).toBe('Kept indefinitely')
    expect(trashDeletesLabel('2026-01-01T00:00:00Z', now)).toBe('Deletes now')
    expect(trashDeletesLabel('2026-01-01T00:10:00Z', now)).toBe('Deletes in 10m')
    expect(trashDeletesLabel('2026-01-01T05:00:00Z', now)).toBe('Deletes in 5h')
    expect(trashDeletesLabel('2026-01-08T00:00:00Z', now)).toBe('Deletes in 7d')
    const midyear = Date.parse('2026-06-01T12:00:00Z')
    expect(trashItemSubtitle({ kind: 'blob', trashedAt: '2025-03-03T12:00:00Z', purgeAt: '2026-06-08T12:00:00Z', sizeBytes: 1_500 }, midyear)).toBe('Mar 3, 2025 · Deletes in 7d · 1.5 KB')
    expect(trashRetentionSummary('30d', true)).toBe('Items are deleted forever after 30 days.')
    expect(trashRetentionSummary('instant', false)).toBe('Chats are deleted right away. Folders stay in the trash for 24 hours.')
  })
})
