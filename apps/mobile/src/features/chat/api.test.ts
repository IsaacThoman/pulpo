import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  queueOfflineMutation: vi.fn(),
  removeSnapshot: vi.fn(),
  receiveSnapshot: vi.fn(),
}))

vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'generated-id' }))
vi.mock('expo-sharing', () => ({}))
vi.mock('../../api/client', () => ({
  apiOrigin: () => 'https://example.com',
  apiRequest: mocks.apiRequest,
  apiUrl: (path: string) => path,
  isNetworkError: (error: unknown) => error instanceof TypeError,
  nativeAuthorizationHeaders: () => ({}),
}))
vi.mock('../../data/database', () => ({
  cacheNamespace: () => 'namespace',
  cachedAttachmentUri: vi.fn(),
  recordCachedAttachment: vi.fn(),
}))
vi.mock('../../data/mutations', () => ({ queueOfflineMutation: mocks.queueOfflineMutation }))
vi.mock('../../providers/realtimeStore', () => ({
  useRealtimeStore: {
    getState: () => ({
      snapshots: {},
      receiveSnapshot: mocks.receiveSnapshot,
      removeSnapshot: mocks.removeSnapshot,
    }),
  },
}))
vi.mock('../../store/preferences', () => ({ usePreferencesStore: { getState: () => ({}) } }))
vi.mock('../../store/session', () => ({
  useSessionStore: { getState: () => ({ instanceUrl: 'https://example.com', user: { id: 'user-1' } }) },
}))

import { editMessage, persistChat, regenerateResponse, sendMessage, startChat } from './api'

beforeEach(() => {
  mocks.apiRequest.mockReset().mockRejectedValue(new TypeError('offline'))
  mocks.queueOfflineMutation.mockReset()
  mocks.removeSnapshot.mockReset()
  mocks.receiveSnapshot.mockReset()
})

describe('temporary chat offline behavior', () => {
  it('does not queue a temporary first turn in durable storage', async () => {
    await expect(startChat({
      chatId: 'chat-1', responseId: 'response-1', content: 'private', modelId: 'model-1',
      title: 'Private', temporary: true,
    })).rejects.toThrow('offline')

    expect(mocks.queueOfflineMutation).not.toHaveBeenCalled()
    expect(mocks.removeSnapshot).toHaveBeenCalledWith('response-1')
  })

  it('does not queue a temporary follow-up in durable storage', async () => {
    await expect(sendMessage({
      chatId: 'chat-1', content: 'private follow-up', modelId: 'model-1', temporary: true,
    })).rejects.toThrow('offline')

    expect(mocks.queueOfflineMutation).not.toHaveBeenCalled()
    expect(mocks.removeSnapshot).toHaveBeenCalledWith('generated-id')
  })
})

describe('temporary chat promotion', () => {
  it('promotes the existing chat through the persist endpoint', async () => {
    mocks.apiRequest.mockResolvedValueOnce({ id: 'chat-1', temporary: false, expiresAt: null })

    await expect(persistChat('chat-1')).resolves.toMatchObject({ temporary: false, expiresAt: null })
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/chats/chat-1/persist', { method: 'POST' })
    expect(mocks.queueOfflineMutation).not.toHaveBeenCalled()
  })
})

describe('automatic chat expiration', () => {
  it('includes the per-chat selection when starting a normal chat', async () => {
    const snapshot = {
      responseId: 'response-1', status: 'queued', sequence: 0, output: [], usage: null, error: null,
      updatedAt: '2026-08-10T00:00:00.000Z',
    }
    mocks.apiRequest.mockResolvedValueOnce({
      chat: { id: 'chat-1', temporary: false, expiresAt: '2026-08-11T00:00:00.000Z' },
      response: snapshot,
    })

    await startChat({
      chatId: 'chat-1', responseId: 'response-1', content: 'expiring', modelId: 'model-1',
      title: 'Expiring', temporary: false, autoExpire: true,
    })

    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/chats/start', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        chat: expect.objectContaining({ temporary: false, autoExpire: true }),
      }),
    }))
  })
})

describe('message edits', () => {
  it('sends attachment and Agent settings for a user branch edit', async () => {
    const snapshot = {
      responseId: 'response-2', status: 'queued', sequence: 0, output: [], usage: null, error: null,
      updatedAt: '2026-08-08T00:00:00.000Z',
    }
    mocks.apiRequest.mockResolvedValueOnce({ response: snapshot })

    await editMessage({
      id: 'response-1:input', content: '', modelId: 'model-1', clientId: 'response-2',
      attachmentIds: ['attachment-2'], agentMode: true, presetSelections: {},
    })

    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/messages/response-1:input', expect.objectContaining({
      method: 'PATCH',
      idempotencyKey: 'response-2',
      body: expect.objectContaining({ attachmentIds: ['attachment-2'], agentMode: true }),
    }))
  })
})

describe('response regeneration', () => {
  it('sends the current Agent and preset selections', async () => {
    const snapshot = {
      responseId: 'response-2', status: 'queued', sequence: 0, output: [], usage: null, error: null,
      updatedAt: '2026-08-08T00:00:00.000Z',
    }
    mocks.apiRequest.mockResolvedValueOnce({ response: snapshot })

    await regenerateResponse('response-1', 'model-1', { reasoning: 'high' }, 'response-2', true)

    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/messages/response-1/regenerate', expect.objectContaining({
      method: 'POST',
      idempotencyKey: 'response-2',
      body: expect.objectContaining({
        modelId: 'model-1',
        presetSelections: { reasoning: 'high' },
        agentMode: true,
      }),
    }))
  })
})
