import { describe, expect, it } from 'vitest'
import type { ServerChat } from '../types'
import { cachedChatIdsToRemove, mergeCachedChat } from './cache'

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
    expect(mergeCachedChat(chat({ responses: [] }), chat({ responses: newer })).responses).toBe(newer)
  })
})

describe('cachedChatIdsToRemove', () => {
  it('removes stale chats only from the reconciled scope', () => {
    const active = chat({ id: 'active', title: 'Active' })
    const stale = chat({ id: 'stale', title: 'Stale' })
    const deleted = chat({ id: 'deleted', title: 'Deleted', deletedAt: new Date().toISOString() })
    expect(cachedChatIdsToRemove([active, stale, deleted], new Set(['active']), 'active', 20)).toEqual(['stale'])
  })

  it('enforces the on-device history limit after reconciliation', () => {
    const chats = ['one', 'two', 'three'].map((id) => chat({ id, title: id }))
    expect(cachedChatIdsToRemove(chats, new Set(chats.map((item) => item.id)), 'active', 2)).toEqual(['three'])
  })
})
