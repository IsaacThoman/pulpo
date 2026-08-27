import { describe, expect, it } from 'vitest'
import { createChatExportPayload, ORDINARY_CHAT_EXPORT_COLLECTIONS } from './export-format.js'

describe('ordinary chat export', () => {
  it('contains chat records but no derived episodic-memory indexes', () => {
    const payload = createChatExportPayload([{ id: 'chat-1' }], [{ id: 'response-1' }], new Date('2026-08-27T00:00:00Z'))
    expect(ORDINARY_CHAT_EXPORT_COLLECTIONS).toEqual(['chats', 'responses'])
    expect(payload).toEqual({
      format: 'pulpo-chat-export',
      version: 2,
      exportedAt: '2026-08-27T00:00:00.000Z',
      chats: [{ id: 'chat-1' }],
      responses: [{ id: 'response-1' }],
    })
    expect(payload).not.toHaveProperty('episodicMemoryGenerations')
    expect(payload).not.toHaveProperty('chatTurnEmbeddings')
    expect(payload).not.toHaveProperty('savedMemoryEmbeddings')
  })
})
