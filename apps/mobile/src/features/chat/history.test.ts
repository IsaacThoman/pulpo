import { describe, expect, it } from 'vitest'
import {
  historyChatSummary,
  resolveHistoryChatExpiryMenuAction,
  reuseHistoryChatSummaries,
  visibleHistoryChats,
} from './history'

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

describe('resolveHistoryChatExpiryMenuAction', () => {
  it('enables expiry using the configured period', () => {
    expect(resolveHistoryChatExpiryMenuAction(null, '24h')).toEqual({ kind: 'enable', periodLabel: '24h' })
    expect(resolveHistoryChatExpiryMenuAction(null, '7d')).toEqual({ kind: 'enable', periodLabel: '7d' })
  })

  it('hides enablement when automatic expiry is disabled', () => {
    expect(resolveHistoryChatExpiryMenuAction(null, 'disabled')).toBeNull()
  })

  it('allows an existing expiry to be disabled regardless of the preference', () => {
    expect(resolveHistoryChatExpiryMenuAction(Date.now() + 60_000, 'disabled')).toEqual({ kind: 'disable' })
  })
})

describe('reuseHistoryChatSummaries', () => {
  const now = Date.UTC(2026, 7, 9, 16)
  const source = {
    id: 'chat-1',
    title: 'Performance investigation',
    modelId: 'gpt-5',
    updatedAt: now - 3_600_000,
    pinned: false,
    folderId: null,
    expiresAt: null,
  }

  it('preserves the list and row when only transcript state changes', () => {
    const before = historyChatSummary({ ...source, messages: [{ text: 'before' }] }, now)
    const after = historyChatSummary({ ...source, messages: [{ text: 'after' }] }, now)
    const previous = [before]

    const reused = reuseHistoryChatSummaries(previous, [after])

    expect(reused).toBe(previous)
    expect(reused[0]).toBe(before)
  })

  it.each([
    ['title', { title: 'Updated title' }],
    ['time', { updatedAt: now - 2 * 86_400_000 }],
    ['pin', { pinned: true }],
    ['folder', { folderId: 'folder-1' }],
    ['expiration', { expiresAt: now + 86_400_000 }],
  ])('replaces a row when its %s metadata changes', (_field, patch) => {
    const before = historyChatSummary(source, now)
    const after = historyChatSummary({ ...source, ...patch }, now)
    const previous = [before]

    const reused = reuseHistoryChatSummaries(previous, [after])

    expect(reused).not.toBe(previous)
    expect(reused[0]).toBe(after)
  })

  it('reuses rows while reflecting ordering, additions, and removals', () => {
    const first = historyChatSummary(source, now)
    const second = historyChatSummary({ ...source, id: 'chat-2', title: 'Second' }, now)
    const third = historyChatSummary({ ...source, id: 'chat-3', title: 'Third' }, now)

    const reordered = reuseHistoryChatSummaries([first, second], [
      historyChatSummary({ ...source, id: 'chat-2', title: 'Second' }, now),
      historyChatSummary(source, now),
    ])
    expect(reordered).toEqual([second, first])
    expect(reordered[0]).toBe(second)
    expect(reordered[1]).toBe(first)

    const added = reuseHistoryChatSummaries(reordered, [...reordered, third])
    expect(added).toEqual([second, first, third])
    expect(added[0]).toBe(second)
    expect(added[1]).toBe(first)

    const removed = reuseHistoryChatSummaries(added, [first, third])
    expect(removed).toEqual([first, third])
    expect(removed[0]).toBe(first)
    expect(removed[1]).toBe(third)
  })
})
