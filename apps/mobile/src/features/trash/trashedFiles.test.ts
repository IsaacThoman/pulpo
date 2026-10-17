import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../api/client', async () => {
  class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message) }
  }
  return { ApiError, apiRequest: request }
})

const { fetchTrashedFiles, trashDeletesLabel, trashedFileIcon } = await import('./trashedFiles')
const { ApiError } = await import('../../api/client')

describe('trashed files', () => {
  beforeEach(() => request.mockReset())

  it('lists only Files items, since chats come from the chat store', async () => {
    request.mockResolvedValue({ retention: '30d', files: true, items: [{ id: 'chat', kind: 'chat' }, { id: 'folder', kind: 'folder' }] })
    expect(await fetchTrashedFiles()).toEqual([{ id: 'folder', kind: 'folder' }])
    expect(request).toHaveBeenCalledWith('/api/trash')
  })

  it('shows chats alone on servers without the shared trash', async () => {
    request.mockImplementationOnce(async () => { throw new ApiError(404, 'not_found', 'Route not found') })
    expect(await fetchTrashedFiles()).toBeNull()
    request.mockImplementationOnce(async () => { throw new ApiError(500, 'server_error', 'Boom') })
    await expect(fetchTrashedFiles()).rejects.toMatchObject({ status: 500 })
  })

  it('picks an icon by kind, following shortcuts to what they open', () => {
    expect(trashedFileIcon({ kind: 'folder', mimeType: null })).toBe('folder')
    expect(trashedFileIcon({ kind: 'doc', mimeType: 'text/markdown' })).toBe('doc.text')
    expect(trashedFileIcon({ kind: 'blob', mimeType: 'image/png' })).toBe('photo')
    expect(trashedFileIcon({ kind: 'blob', mimeType: 'application/pdf' })).toBe('doc')
    expect(trashedFileIcon({ kind: 'shortcut', mimeType: null, target: { kind: 'chat', id: 'c', name: 'Chat', mimeType: null, systemRole: null, available: true } })).toBe('bubble.left')
  })

  it('describes when an item is deleted', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(trashDeletesLabel(null, now)).toBe('kept indefinitely')
    expect(trashDeletesLabel('2026-01-01T00:00:00Z', now)).toBe('deletes now')
    expect(trashDeletesLabel('2026-01-01T00:10:00Z', now)).toBe('deletes in 10m')
    expect(trashDeletesLabel('2026-01-01T05:00:00Z', now)).toBe('deletes in 5h')
    expect(trashDeletesLabel('2026-01-08T00:00:00Z', now)).toBe('deletes in 7d')
  })
})
