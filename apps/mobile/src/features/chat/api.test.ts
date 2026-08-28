import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  queueOfflineMutation: vi.fn(),
  removeSnapshot: vi.fn(),
  receiveSnapshot: vi.fn(),
  directoryCreate: vi.fn(),
  fileCopy: vi.fn(),
  fileDelete: vi.fn(),
  fileUpload: vi.fn(),
  fileSize: 8,
  recordCachedAttachment: vi.fn(),
  removeCachedAttachment: vi.fn(),
}))

vi.mock('expo-file-system', () => {
  const joinUri = (parts: Array<string | { uri: string }>) => parts
    .map((part, index) => {
      const value = typeof part === 'string' ? part : part.uri
      return index === 0 ? value.replace(/\/+$/, '') : value.replace(/^\/+|\/+$/g, '')
    })
    .join('/')
  return {
    Directory: class {
      uri: string
      constructor(...parts: Array<string | { uri: string }>) { this.uri = joinUri(parts) }
      create = mocks.directoryCreate
    },
    File: class {
      exists = true
      get size() { return mocks.fileSize }
      uri: string
      constructor(...parts: Array<string | { uri: string }>) { this.uri = joinUri(parts) }
      copy = mocks.fileCopy
      delete = mocks.fileDelete
      upload = mocks.fileUpload
    },
    Paths: { cache: { uri: 'file:///cache' } },
  }
})
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
  recordCachedAttachment: mocks.recordCachedAttachment,
  removeCachedAttachment: mocks.removeCachedAttachment,
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
vi.mock('../../store/preferences', () => ({ usePreferencesStore: { getState: () => ({ attachmentCacheMb: 256 }) } }))
vi.mock('../../store/session', () => ({
  useSessionStore: { getState: () => ({ instanceUrl: 'https://example.com', user: { id: 'user-1' } }) },
}))

import { cacheUploadedAttachment, deleteUnreferencedAttachment, editMessage, persistChat, regenerateResponse, safeAttachmentFilename, sendMessage, startChat, uploadAttachment } from './api'

beforeEach(() => {
  mocks.apiRequest.mockReset().mockRejectedValue(new TypeError('offline'))
  mocks.queueOfflineMutation.mockReset()
  mocks.removeSnapshot.mockReset()
  mocks.receiveSnapshot.mockReset()
  mocks.directoryCreate.mockReset()
  mocks.fileCopy.mockReset()
  mocks.fileDelete.mockReset()
  mocks.fileUpload.mockReset()
  mocks.fileSize = 8
  mocks.recordCachedAttachment.mockReset().mockResolvedValue([])
  mocks.removeCachedAttachment.mockReset().mockResolvedValue(null)
})

describe('attachment cache filenames', () => {
  it('preserves user-facing names while removing unsafe path characters', () => {
    expect(safeAttachmentFilename('Quarterly Plan 你好.pdf')).toBe('Quarterly Plan 你好.pdf')
    expect(safeAttachmentFilename('../draft\\notes:final?.txt')).toBe('..-draft-notes-final-.txt')
  })

  it('promotes an uploaded local file into the server attachment cache', async () => {
    await cacheUploadedAttachment('attachment-1', 'Photo 1.jpg', 'file:///picker/Photo 1.jpg')

    expect(mocks.directoryCreate).toHaveBeenCalledWith({ idempotent: true, intermediates: true })
    expect(mocks.fileCopy).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///cache/attachments/attachment-1/Photo 1.jpg' }),
      { overwrite: true },
    )
    expect(mocks.recordCachedAttachment).toHaveBeenCalledWith(
      'namespace',
      'attachment-1',
      'file:///cache/attachments/attachment-1/Photo 1.jpg',
      8,
      256 * 1024 * 1024,
    )
  })
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

describe('attachment uploads', () => {
  const draft = {
    localId: 'local-1', name: 'notes.bin', uri: 'file:///notes.bin', mimeType: 'application/octet-stream',
    sizeBytes: 8, state: 'uploading' as const,
  }
  const reservation = {
    attachment: { id: 'reserved-1' }, uploadUrl: '/upload/reserved-1', uploadHeaders: {},
  }

  it('validates a selected file before creating a remote reservation', async () => {
    mocks.fileSize = 0

    await expect(uploadAttachment(draft, null)).rejects.toThrow('Attachment is empty')
    expect(mocks.apiRequest).not.toHaveBeenCalled()
    expect(mocks.fileUpload).not.toHaveBeenCalled()
  })

  it('reserves the copied file size instead of optional provider metadata', async () => {
    mocks.apiRequest
      .mockResolvedValueOnce(reservation)
      .mockResolvedValueOnce({ id: 'reserved-1', mimeType: 'application/octet-stream' })
    mocks.fileUpload.mockResolvedValueOnce({ status: 204 })

    await uploadAttachment({ ...draft, sizeBytes: 0 }, null)

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, '/api/attachments', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ sizeBytes: 8 }),
    }))
  })

  it('keeps the MIME type confirmed by the server', async () => {
    mocks.apiRequest
      .mockResolvedValueOnce(reservation)
      .mockResolvedValueOnce({ id: 'reserved-1', mimeType: 'text/plain' })
    mocks.fileUpload.mockResolvedValueOnce({ status: 204 })

    await expect(uploadAttachment(draft, null)).resolves.toMatchObject({
      id: 'reserved-1', mimeType: 'text/plain',
    })
    expect(mocks.recordCachedAttachment).toHaveBeenCalledWith(
      'namespace', 'reserved-1', 'file:///cache/attachments/reserved-1/notes.bin', 8, 256 * 1024 * 1024,
    )
  })

  it('deletes an unreferenced reservation when transfer fails', async () => {
    mocks.apiRequest.mockResolvedValueOnce(reservation).mockResolvedValueOnce(undefined)
    mocks.fileUpload.mockRejectedValueOnce(new Error('Connection lost'))

    await expect(uploadAttachment(draft, null)).rejects.toThrow('Connection lost')
    expect(mocks.apiRequest).toHaveBeenLastCalledWith('/api/attachments/reserved-1', { method: 'DELETE' })
  })

  it('removes the promoted cache file when an upload becomes unreferenced', async () => {
    mocks.apiRequest.mockResolvedValueOnce(undefined)
    mocks.removeCachedAttachment.mockResolvedValueOnce('file:///cache/attachments/reserved-1/notes.bin')

    await deleteUnreferencedAttachment('reserved-1')

    expect(mocks.removeCachedAttachment).toHaveBeenCalledWith('namespace', 'reserved-1')
    expect(mocks.fileDelete).toHaveBeenCalledOnce()
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
