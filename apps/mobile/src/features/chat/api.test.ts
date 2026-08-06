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

import { persistChat, sendMessage, startChat } from './api'

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
