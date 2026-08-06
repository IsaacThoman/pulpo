import { describe, expect, it } from 'vitest'
import { visibleHistoryChats } from './history'

describe('visibleHistoryChats', () => {
  it('excludes temporary and deleted chats from mobile history', () => {
    const chats = [
      { id: 'saved', deletedAt: null, temporary: false },
      { id: 'temporary', deletedAt: null, temporary: true },
      { id: 'deleted', deletedAt: Date.now(), temporary: false },
    ]

    expect(visibleHistoryChats(chats).map((chat) => chat.id)).toEqual(['saved'])
  })
})
