import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { MobileQueuedMessage, ServerChat } from '../../types'
const mocks = vi.hoisted(() => ({ request: vi.fn(), offline: vi.fn(), pending: vi.fn(), cache: vi.fn() }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'submission-1' }))
vi.mock('../../api/client', () => ({ apiRequest: mocks.request, isNetworkError: (error: unknown) => error instanceof TypeError }))
vi.mock('../../data/database', () => ({ cacheOpenedChat: mocks.cache, pendingOutbox: mocks.pending }))
vi.mock('../../data/mutations', () => ({ queueOfflineMutation: mocks.offline }))
vi.mock('../../data/queries', () => ({ queryKeys: { chat: (namespace: string, id: string) => ['chat', namespace, id] } }))
import { enqueueMessage, mutateQueuedMessage } from './messageQueue'
import { reconcileQueuedMessages, reorderQueue, shouldQueueMessage, submittingQueueIds } from './messageQueuePolicy'
import { mergeCachedChat } from '../../data/cache'
import { composerGenerationAction } from './generationControls'
import { flushCacheWrites } from '../../data/writeBehind'

function queued(id = 'one', overrides: Partial<MobileQueuedMessage> = {}): MobileQueuedMessage {
  return { id, chatId: 'chat', content: id, modelId: 'model', presetSelections: { reasoning: 'high' }, agentMode: true,
    position: 0, status: 'pending', error: null, attachments: [], createdAt: '2026-09-04T00:00:00Z', updatedAt: '2026-09-04T00:00:00Z', ...overrides }
}
function chat(queue: MobileQueuedMessage[] = []): ServerChat {
  return { id: 'chat', title: 'Queue', modelId: 'model', pinned: false, folderId: null, sortOrder: 0, temporary: false,
    activeResponseId: 'running', createdAt: '', updatedAt: '', responses: [], queuedMessages: queue }
}
const input = { input: 'Next', modelId: 'model', presetSelections: { reasoning: 'high' }, agentMode: true, attachmentIds: ['file'] }
const attachments = [{ id: 'file', name: 'image.png', mimeType: 'image/png', sizeBytes: 20 }]
let client: QueryClient
const key = ['chat', 'account', 'chat']
const queue = () => client.getQueryData<ServerChat>(key)!.queuedMessages!
beforeEach(() => {
  vi.clearAllMocks()
  submittingQueueIds.clear()
  mocks.pending.mockResolvedValue([])
  mocks.cache.mockResolvedValue(undefined)
  mocks.offline.mockResolvedValue(undefined)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(key, chat())
})

describe('mobile queue policy and projection', () => {
  it('queues behind an active response or a paused queue and preserves empty-composer Stop', () => {
    expect(shouldQueueMessage(true, 0)).toBe(true)
    expect(shouldQueueMessage(false, 1)).toBe(true)
    expect(shouldQueueMessage(false, 0)).toBe(false)
    expect(composerGenerationAction('streaming', false, true)).toBe('submit')
    expect(composerGenerationAction('streaming', false, false)).toBe('stop')
  })
  it('preserves queue details on summaries but accepts authoritative empty queues', () => {
    expect(mergeCachedChat(chat([queued()]), { ...chat(), queuedMessages: undefined }).queuedMessages).toEqual([queued()])
    expect(mergeCachedChat(chat([queued()]), chat()).queuedMessages).toEqual([])
  })
  it('retains only unsynced or failed local submissions across realtime refreshes', () => {
    const pending = queued('local', { pendingSubmissionId: 'local' })
    const failed = queued('failed', { pendingSubmissionId: 'failed', localFailure: true, status: 'failed' })
    expect(reconcileQueuedMessages([], [pending, failed, queued()], new Set(['local']))).toEqual([pending, failed])
    expect(reconcileQueuedMessages([], [pending], new Set())).toEqual([])
    submittingQueueIds.add('local')
    expect(reconcileQueuedMessages([], [pending], new Set())).toEqual([pending])
  })
  it('reorders without mutating the input and ignores invalid or dispatching moves', () => {
    const items = [queued('one'), queued('two', { position: 1 }), queued('three', { position: 2 })]
    expect(reorderQueue(items, 'three', 'one', 'before').map((item) => [item.id, item.position])).toEqual([['three', 0], ['one', 1], ['two', 2]])
    expect(items[0]!.id).toBe('one')
    expect(reorderQueue(items, 'three', 'missing', 'before')).toBe(items)
    const dispatching = [queued('one', { status: 'dispatching' })]
    expect(reorderQueue(dispatching, 'one', 'two', 'after')).toBe(dispatching)
  })
})

describe('mobile queue operations', () => {
  it('stages a queue item without a response and reconciles its server identity and attachments', async () => {
    let resolve!: (value: unknown) => void
    mocks.request.mockImplementation(() => new Promise((done) => { resolve = done }))
    const pending = enqueueMessage(client, 'account', 'chat', input, attachments, false)
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalled())
    expect(queue()[0]).toMatchObject({ pendingSubmissionId: 'submission-1', attachments, content: 'Next' })
    expect(client.getQueryData<ServerChat>(key)!.responses).toEqual([])
    resolve({ queuedMessage: queued('server', { attachments }) })
    await pending
    expect(queue()).toEqual([queued('server', { attachments })])
    expect(mocks.request.mock.calls[0]![1]).toMatchObject({ body: { ...input, clientId: 'submission-1' }, idempotencyKey: 'submission-1' })
  })
  it('removes the optimistic item when the server already dispatched it', async () => {
    mocks.request.mockResolvedValue({ queuedMessage: null })
    await enqueueMessage(client, 'account', 'chat', input, attachments, false)
    expect(queue()).toEqual([])
  })
  it('persists a network failure with the same client identity for replay', async () => {
    mocks.request.mockRejectedValue(new TypeError('offline'))
    await enqueueMessage(client, 'account', 'chat', input, attachments, false)
    await flushCacheWrites('account')
    expect(mocks.offline).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'submission-1', body: { ...input, clientId: 'submission-1' } }))
    expect(queue()[0]?.pendingSubmissionId).toBe('submission-1')
    expect(mocks.cache).toHaveBeenCalled()
  })
  it('keeps later submissions behind offline chat creation without attempting delivery', async () => {
    mocks.pending.mockResolvedValue([{ id: 'chat-creation' }])
    await enqueueMessage(client, 'account', 'chat', input, attachments, false)
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.offline).toHaveBeenCalledOnce()
  })
  it('rolls back rejected submissions and never persists temporary chat failures', async () => {
    mocks.request.mockRejectedValue(new TypeError('offline'))
    await expect(enqueueMessage(client, 'account', 'chat', input, attachments, true)).rejects.toThrow('offline')
    expect(queue()).toEqual([])
    expect(mocks.offline).not.toHaveBeenCalled()
  })
  it('saves generation settings and attachments through the existing edit action', async () => {
    client.setQueryData(key, chat([queued('one', { status: 'editing' })]))
    const saved = queued('one', { content: input.input, attachments })
    mocks.request.mockResolvedValue({ queuedMessage: saved })
    await mutateQueuedMessage(client, 'account', 'chat', 'one', { action: 'save_edit', ...input }, attachments)
    expect(queue()).toEqual([saved])
    expect(mocks.request).toHaveBeenCalledWith('/api/chats/chat/queued-messages/one', { method: 'PATCH', body: { action: 'save_edit', ...input } })
  })
  it('rolls back edit locks and reorder failures', async () => {
    const previous = [queued(), queued('two', { position: 1 })]
    client.setQueryData(key, chat(previous))
    mocks.request.mockRejectedValue(new Error('conflict'))
    await expect(mutateQueuedMessage(client, 'account', 'chat', 'one', { action: 'begin_edit' })).rejects.toThrow('conflict')
    expect(queue()).toEqual(previous)
    await expect(mutateQueuedMessage(client, 'account', 'chat', 'two', { action: 'reorder', targetMessageId: 'one', edge: 'before' })).rejects.toThrow('conflict')
    expect(queue()).toEqual(previous)
  })
  it('preserves unrelated realtime additions when a mutation fails', async () => {
    client.setQueryData(key, chat([queued()]))
    let reject!: (error: Error) => void
    mocks.request.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const mutation = mutateQueuedMessage(client, 'account', 'chat', 'one', { action: 'begin_edit' })
    const assertion = expect(mutation).rejects.toThrow('conflict')
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalled())
    client.setQueryData(key, chat([...queue(), queued('remote')]))
    reject(new Error('conflict'))
    await assertion
    expect(queue().map((item) => item.id)).toEqual(['one', 'remote'])
  })

  it('blocks operations on dispatching and unsynced items', async () => {
    for (const item of [queued('one', { status: 'dispatching' }), queued('one', { pendingSubmissionId: 'one' })]) {
      client.setQueryData(key, chat([item]))
      await expect(mutateQueuedMessage(client, 'account', 'chat', 'one', { action: 'delete' })).rejects.toThrow()
    }
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('lets rejected offline messages be edited, retried, or discarded without losing content', async () => {
    client.setQueryData(key, chat([queued('failed', { localFailure: true, pendingSubmissionId: 'failed', status: 'failed' })]))
    await mutateQueuedMessage(client, 'account', 'chat', 'failed', { action: 'begin_edit' })
    expect(queue()[0]?.status).toBe('editing')
    await mutateQueuedMessage(client, 'account', 'chat', 'failed', { action: 'cancel_edit' })
    expect(queue()[0]?.status).toBe('failed')
    mocks.request.mockResolvedValue({ queuedMessage: queued('retry') })
    await mutateQueuedMessage(client, 'account', 'chat', 'failed', { action: 'save_edit', ...input }, attachments)
    expect(queue()).toEqual([queued('retry')])
    mocks.request.mockResolvedValue(undefined)
    await mutateQueuedMessage(client, 'account', 'chat', 'retry', { action: 'delete' })
    expect(queue()).toEqual([])
  })
})
