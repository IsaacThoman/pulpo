import { describe, expect, it, vi } from 'vitest'
import { createEpisodicMemoryTools, decodeEpisodicCursor, fitTranscriptPageBytes, type EpisodicTranscriptPage } from './agent-tools.js'

describe('episodic-memory agent tools', () => {
  it('bounds search results, excludes the current chat through the service input, and marks the operation started', async () => {
    const search = vi.fn().mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({
      chatId: `chat-${index}`,
      responseId: `response-${index}`,
      title: `Result ${index}`,
      updatedAt: '2026-08-27T00:00:00.000Z',
      excerpt: 'Relevant excerpt',
      score: 1 - index / 100,
    })))
    const started = vi.fn()
    const [tool] = createEpisodicMemoryTools({
      userId: 'user-1', currentChatId: 'current-chat', maxOutputBytes: 100_000, search, onOperationStarted: started,
    })

    const result = await tool!.execute('search-1', { query: 'old project', limit: 10 })
    const payload = JSON.parse((result.content[0] as { text: string }).text) as { results: unknown[]; pagination: { hasMore: boolean } }

    expect(started).toHaveBeenCalledWith('search-1')
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', currentChatId: 'current-chat', limit: 11 }))
    expect(payload.results).toHaveLength(10)
    expect(payload.pagination.hasMore).toBe(true)
  })

  it('passes bounded pagination to read_chat and rejects unavailable chats', async () => {
    const page: EpisodicTranscriptPage = {
      chat: { id: 'source', title: 'Source', updatedAt: '2026-08-27T00:00:00.000Z' },
      turns: [],
      pagination: { returned: 0, maxTurns: 20, hasMore: false, nextCursor: null, direction: 'older', truncatedByBytes: false },
      safety: 'untrusted',
    }
    const read = vi.fn().mockResolvedValue(page)
    const tools = createEpisodicMemoryTools({ userId: 'user-1', currentChatId: 'current-chat', maxOutputBytes: 4_096, read })
    const tool = tools.find((candidate) => candidate.name === 'read_chat')!

    await tool.execute('read-1', { chat_id: 'source', max_turns: 999 })
    expect(read).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', currentChatId: 'current-chat', chatId: 'source', maxTurns: 20,
    }))

    read.mockResolvedValueOnce(null)
    await expect(tool.execute('read-2', { chat_id: 'current-chat' })).rejects.toThrow('unavailable')
  })

  it('uses opaque validated cursors and keeps transcript JSON under the byte limit', () => {
    expect(() => decodeEpisodicCursor('not-a-cursor')).toThrow('cursor is invalid')
    const page = fitTranscriptPageBytes(
      { id: 'chat', title: 'Long chat', updatedAt: '2026-08-27T00:00:00.000Z' },
      [{ responseId: 'response', createdAt: '2026-08-27T00:00:00.000Z', text: '🐙'.repeat(5_000) }],
      8,
      0,
      false,
      1_024,
    )
    expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(1_024)
    expect(page.pagination.truncatedByBytes).toBe(true)
    expect(page.pagination.nextCursor).not.toBeNull()
    expect(decodeEpisodicCursor(page.pagination.nextCursor)).toBe(1)
  })

  it('honors cancellation before invoking retrieval', async () => {
    const search = vi.fn()
    const [tool] = createEpisodicMemoryTools({ userId: 'user', currentChatId: 'current', maxOutputBytes: 4_096, search })
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(tool!.execute('search-cancelled', { query: 'anything' }, controller.signal)).rejects.toThrow('cancelled')
    expect(search).not.toHaveBeenCalled()
  })
})
