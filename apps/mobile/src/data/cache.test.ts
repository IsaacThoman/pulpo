import { describe, expect, it } from 'vitest'
import type { ServerChat } from '../types'
import {
  cachedChatDetailIdsToEvict,
  cachedChatIdsToRemove,
  mergeCachedChat,
  persistableChats,
  utf8ByteLength,
  withoutCachedChatDetails,
} from './cache'

function chat(overrides: Partial<ServerChat> = {}): ServerChat {
  return {
    id: 'chat-1', title: 'Original', modelId: 'model-1', pinned: false, folderId: null,
    sortOrder: 0, temporary: false, activeResponseId: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('mergeCachedChat', () => {
  it('preserves detailed response and attachment data during a summaries refresh', () => {
    const responses = [{ id: 'response-1' }] as ServerChat['responses']
    const attachments = [{ id: 'file-1', originalName: 'a.txt', mimeType: 'text/plain', sizeBytes: 4 }]
    const merged = mergeCachedChat(chat({ responses, attachments }), chat({ title: 'Renamed', updatedAt: '2026-08-02T00:00:00.000Z' }))
    expect(merged.title).toBe('Renamed')
    expect(merged.responses).toBe(responses)
    expect(merged.attachments).toBe(attachments)
  })

  it('accepts newer detailed data when it is available', () => {
    const newer = [{ id: 'response-2' }] as ServerChat['responses']
    expect(mergeCachedChat(chat({ responses: [] }), chat({ responses: newer })).responses).toEqual(newer)
  })

  it('keeps a previously fetched branch body when an active-only refresh returns a stub', () => {
    const snapshot = {
      responseId: 'response-1', status: 'completed' as const, sequence: 1,
      usage: null, error: null, updatedAt: '2026-08-02T00:00:00.000Z',
    }
    const detailed = {
      id: 'response-1', parentResponseId: null, previousResponseId: null, userMessageId: null,
      modelId: 'model-1', status: 'completed' as const, input: ['prompt'], output: ['answer'],
      presetSelections: {}, agentMode: false, usage: null, error: null,
      createdAt: '2026-08-01T00:00:00.000Z', completedAt: '2026-08-01T00:00:01.000Z',
      snapshot, branches: { user: { ids: ['response-1'], index: 0 }, assistant: { ids: ['response-1'], index: 0 } },
      detailAvailable: true,
    }
    const stub = { ...detailed, input: [], output: [], detailAvailable: false }

    const merged = mergeCachedChat(chat({ responses: [detailed] }), chat({ responses: [stub] }))

    expect(merged.responses?.[0]).toMatchObject({ input: ['prompt'], output: ['answer'], detailAvailable: true })
  })
})

describe('persistableChats', () => {
  it('never returns temporary chats for durable storage', () => {
    expect(persistableChats([chat(), chat({ id: 'temporary', temporary: true })]).map((item) => item.id)).toEqual(['chat-1'])
  })
})

describe('cachedChatIdsToRemove', () => {
  it('removes stale chats only from the reconciled scope', () => {
    const active = chat({ id: 'active', title: 'Active' })
    const stale = chat({ id: 'stale', title: 'Stale' })
    const deleted = chat({ id: 'deleted', title: 'Deleted', deletedAt: new Date().toISOString() })
    expect(cachedChatIdsToRemove([active, stale, deleted], new Set(['active']), 'active')).toEqual(['stale'])
  })

  it('keeps summaries while removing an evicted offline document', () => {
    const summary = withoutCachedChatDetails(chat({
      responses: [{ id: 'response-1' }] as ServerChat['responses'],
      attachments: [{ id: 'file-1', originalName: 'a.txt', mimeType: 'text/plain', sizeBytes: 4 }],
    }))
    expect(summary.responses).toBeUndefined()
    expect(summary.attachments).toBeUndefined()
    expect(summary.title).toBe('Original')
  })
})

describe('cached chat detail byte limits', () => {
  it('measures multibyte payloads as UTF-8', () => {
    expect(utf8ByteLength('a🐙é')).toBe(7)
  })

  it('evicts oversized recent records and retains smaller records within both ceilings', () => {
    expect(cachedChatDetailIdsToEvict([
      { chatId: 'large', openedAt: 3, payloadBytes: 12 },
      { chatId: 'middle', openedAt: 2, payloadBytes: 6 },
      { chatId: 'old', openedAt: 1, payloadBytes: 4 },
    ], 2, 10)).toEqual(['large'])
  })
})
