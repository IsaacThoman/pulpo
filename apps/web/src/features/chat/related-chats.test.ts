import { describe, expect, it } from 'vitest'
import type { RelatedChat, RelatedChats } from '@pulpo/contracts'
import { groupThreads, relatedChatsSummary } from './related-chats'

function related(id: string, overrides: Partial<RelatedChat> = {}): RelatedChat {
  return { id, kind: 'thread', title: id, createdAt: '2026-11-18T00:00:00.000Z', updatedAt: '2026-11-18T00:00:00.000Z', status: 'working', summary: null, ...overrides }
}

describe('groupThreads', () => {
  it('groups threads by status in list order and leaves out empty groups', () => {
    const groups = groupThreads([
      related('a', { status: 'done' }),
      related('b', { status: 'working' }),
      related('c', { status: 'resolved' }),
      related('d', { status: 'done' }),
    ])
    expect(groups.map((group) => [group.status, group.threads.map((thread) => thread.id)])).toEqual([
      ['working', ['b']],
      ['done', ['a', 'd']],
      ['resolved', ['c']],
    ])
  })
})

describe('relatedChatsSummary', () => {
  it('counts threads and side chats and flags attention and work', () => {
    const value: RelatedChats = {
      origin: null,
      project: null,
      sideChats: [related('s', { kind: 'side', status: null })],
      threads: [related('a', { status: 'attention' }), related('b', { status: 'resolved' })],
    }
    expect(relatedChatsSummary(value)).toEqual({ count: 3, open: 1, attention: true, working: false })
    expect(relatedChatsSummary(undefined)).toEqual({ count: 0, open: 0, attention: false, working: false })
  })
})
