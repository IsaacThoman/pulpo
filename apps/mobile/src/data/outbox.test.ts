import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { ServerChat, MobileQueuedMessage } from '../types'
const mocks = vi.hoisted(() => ({ request: vi.fn(), complete: vi.fn(), fail: vi.fn(), pending: vi.fn(), cached: vi.fn(), cache: vi.fn() }))
vi.mock('../api/client', () => ({ apiRequest: mocks.request, ApiError: class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message) } } }))
vi.mock('./database', () => ({ completeOutbox: mocks.complete, failOutbox: mocks.fail, pendingOutbox: mocks.pending, cachedChat: mocks.cached, cacheChats: mocks.cache }))
vi.mock('./queries', () => ({ queryKeys: { chat: (namespace: string, id: string) => ['chat', namespace, id] } }))
import { replayOutbox } from './outbox'
import { ApiError } from '../api/client'
const pending: MobileQueuedMessage = { id: 'submission', pendingSubmissionId: 'submission', chatId: 'chat', content: 'Keep my draft', modelId: 'model', presetSelections: {}, agentMode: false, position: 0, status: 'pending', error: null, attachments: [], createdAt: '', updatedAt: '' }
const saved: MobileQueuedMessage = { ...pending, pendingSubmissionId: undefined }
const row = { id: 'submission', namespace: 'account', entityKey: 'queued-message:submission', method: 'POST', path: '/api/chats/chat/queued-messages', body: JSON.stringify({ clientId: 'submission', input: pending.content }), createdAt: 1, attempts: 0, nextAttemptAt: 0 }
const key = ['chat', 'account', 'chat']
let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient()
  const chat = { id: 'chat', temporary: false, queuedMessages: [pending] } as ServerChat
  client.setQueryData(key, chat)
  mocks.cached.mockResolvedValue(chat)
  mocks.pending.mockResolvedValue([row])
  mocks.cache.mockResolvedValue(undefined)
  mocks.complete.mockResolvedValue(undefined)
  mocks.fail.mockResolvedValue(undefined)
})
describe('queued-message outbox replay', () => {
  it('reconciles the durable queue before completing the outbox item', async () => {
    mocks.request.mockResolvedValue({ queuedMessage: saved })
    await expect(replayOutbox('account', client)).resolves.toEqual({ replayed: 1, rejected: 0 })
    expect(client.getQueryData<ServerChat>(key)?.queuedMessages).toEqual([saved])
    expect(mocks.cache.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]!)
    expect(mocks.request).toHaveBeenCalledWith(row.path, expect.objectContaining({ idempotencyKey: row.id, body: JSON.parse(row.body) }))
  })
  it('removes a local item already dispatched by the server', async () => {
    mocks.request.mockResolvedValue({ queuedMessage: null })
    await replayOutbox('account', client)
    expect(client.getQueryData<ServerChat>(key)?.queuedMessages).toEqual([])
  })
  it('preserves a rejected message as an editable failed item', async () => {
    mocks.request.mockRejectedValue(new ApiError(400, 'model_not_found', 'Choose another model'))
    await expect(replayOutbox('account', client)).resolves.toEqual({ replayed: 0, rejected: 1 })
    expect(client.getQueryData<ServerChat>(key)?.queuedMessages?.[0]).toMatchObject({ content: pending.content, localFailure: true, status: 'failed', error: 'Choose another model' })
  })
  it('keeps a transient failure and stops before later submissions', async () => {
    mocks.pending.mockResolvedValue([row, { ...row, id: 'later', createdAt: 2 }])
    mocks.request.mockRejectedValue(new TypeError('offline'))
    await expect(replayOutbox('account', client)).resolves.toEqual({ replayed: 0, rejected: 0 })
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.fail).toHaveBeenCalledWith('submission', 1, 'offline')
  })
  it('retains timed-out submissions for idempotent replay', async () => {
    mocks.request.mockRejectedValue(new ApiError(408, 'request_timeout', 'Timed out'))
    await expect(replayOutbox('account', client)).resolves.toEqual({ replayed: 0, rejected: 0 })
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.fail).toHaveBeenCalledOnce()
  })
})
describe('chat start outbox replay', () => {
  const start = { id: 'response', namespace: 'account', entityKey: 'response:response', method: 'POST', path: '/api/chats/start', body: JSON.stringify({ chat: { clientId: 'started', fileScopeIds: ['kept', 'trashed', 'gone'], fileScopeAccess: { kept: 'write' } }, response: { clientId: 'response', input: 'Summarize these' } }), createdAt: 1, attempts: 0, nextAttemptAt: 0 }
  it('starts a chat whose Files items were trashed or deleted elsewhere with the items that remain', async () => {
    mocks.pending.mockResolvedValue([start])
    mocks.request.mockImplementation(async (path: string, options?: { body?: { chat: { fileScopeIds: string[] } } }) => {
      if (path === '/api/files/kept') return { node: { id: 'kept', kind: 'doc', status: 'ready', trashedAt: null } }
      if (path === '/api/files/trashed') return { node: { id: 'trashed', kind: 'doc', status: 'ready', trashedAt: '2026-10-17T00:00:00.000Z' } }
      if (path === '/api/files/gone') throw new ApiError(404, 'not_found', 'Not found')
      if (options?.body?.chat.fileScopeIds.length !== 1) throw new ApiError(400, 'invalid_file_scope', 'Choose items from your files')
      return {}
    })
    await expect(replayOutbox('account', client)).resolves.toEqual({ replayed: 1, rejected: 0 })
    expect(mocks.request).toHaveBeenLastCalledWith('/api/chats/start', expect.objectContaining({
      idempotencyKey: 'response',
      body: expect.objectContaining({ chat: expect.objectContaining({ fileScopeIds: ['kept'], fileScopeAccess: { kept: 'write' } }), response: expect.objectContaining({ input: 'Summarize these' }) }),
    }))
  })
  it('tries the start again later when its Files items cannot be checked', async () => {
    mocks.pending.mockResolvedValue([start])
    mocks.request.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/files/')) throw new TypeError('offline')
      throw new ApiError(400, 'invalid_file_scope', 'Choose items from your files')
    })
    await expect(replayOutbox('account', client)).resolves.toEqual({ replayed: 0, rejected: 0 })
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.fail).toHaveBeenCalledOnce()
  })
})
