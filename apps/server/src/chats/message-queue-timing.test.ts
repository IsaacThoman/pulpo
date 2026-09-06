import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selects: [] as unknown[][],
  claim: {} as Record<string, unknown>,
  createResponse: vi.fn(),
}))
vi.mock('../database/client.js', () => {
  const db = {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
    execute: vi.fn(),
    select: () => {
      const query = {
        from: () => query, where: () => query, orderBy: () => query, limit: () => query,
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(mocks.selects.shift() ?? []).then(resolve),
      }
      return query
    },
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [mocks.claim] }) }) }),
    delete: () => ({ where: vi.fn() }),
  }
  return { db }
})
vi.mock('../responses/service.js', () => ({ createResponse: mocks.createResponse, resolveResponseGeneration: vi.fn() }))
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))

const { advanceMessageQueue } = await import('./message-queue.js')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.claim = {
    id: 'queued-1', dispatchResponseId: 'response-1', userId: 'user-1', chatId: 'chat-1',
    content: 'Question', modelId: 'model-1', presetSelections: {}, attachmentIds: [], agentMode: false,
    status: 'pending', requestReceivedAt: new Date('2026-09-06T12:00:00Z'), createdAt: new Date('2026-09-06T12:00:02Z'),
  }
  mocks.selects = [[{ id: 'chat-1' }], [], [mocks.claim], [], [{ activeResponseId: null }], []]
})

describe('queued response timing', () => {
  it('retains original server receipt through delayed dispatch', async () => {
    await advanceMessageQueue('chat-1')
    expect(mocks.createResponse).toHaveBeenCalledWith(expect.objectContaining({ requestReceivedAt: mocks.claim.requestReceivedAt }))
  })
  it('uses creation time for a queue entry predating the timing migration', async () => {
    mocks.claim.requestReceivedAt = null
    await advanceMessageQueue('chat-1')
    expect(mocks.createResponse).toHaveBeenCalledWith(expect.objectContaining({ requestReceivedAt: mocks.claim.createdAt }))
  })
  it('does not reset timing when a response already exists after a dispatch retry', async () => {
    mocks.selects[3] = [{ id: 'response-1' }]
    await advanceMessageQueue('chat-1')
    expect(mocks.createResponse).not.toHaveBeenCalled()
  })
})
