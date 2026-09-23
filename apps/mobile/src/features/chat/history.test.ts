import { describe, expect, it, vi } from 'vitest'
import {
  createHistoryProjector,
  historyFolderItems,
  historyChatSections,
  historyChatSummary,
  resolveHistoryChatExpiryMenuAction,
  reuseHistoryChatSummaries,
  topChatSortOrder,
  visibleHistoryChats,
  type HistoryChatSummary,
} from './history'

function summary(id: string, patch: Partial<HistoryChatSummary> = {}): HistoryChatSummary {
  return {
    id, title: id, modelId: 'gpt-5', time: '1:00 PM', section: 'Today',
    pinned: false, folderId: null, sortOrder: 0, createdAt: 1_000, expiresAt: null, ...patch,
  }
}

describe('historyChatSections', () => {
  it('always places pinned chats in the first section', () => {
    const newerUnpinned = summary('newer')
    const olderPinned = summary('pinned', { time: 'Aug 1', section: 'Pinned', pinned: true })

    const sections = historyChatSections([newerUnpinned, olderPinned])

    expect(sections.map((section) => section.title)).toEqual(['Pinned', 'Chats'])
    expect(sections[0]?.data).toEqual([olderPinned])
  })

  it('orders chats by their manual position, not their last activity', () => {
    const active = summary('active', { sortOrder: 2, createdAt: 3_000, section: 'Today' })
    const top = summary('top', { sortOrder: -1, createdAt: 1_000, section: 'Previous 30 Days' })
    const newest = summary('newest', { sortOrder: 0, createdAt: 2_000 })
    const older = summary('older', { sortOrder: 0, createdAt: 500 })

    expect(historyChatSections([active, older, newest, top])[0]?.data.map((chat) => chat.id))
      .toEqual(['top', 'newest', 'older', 'active'])
  })

  it('keeps filed chats in their folders unless searching', () => {
    const folders = [{ id: 'b' }, { id: 'a' }]
    const loose = summary('loose', { sortOrder: 5 })
    const inA = summary('in-a', { folderId: 'a' })
    const inB = summary('in-b', { folderId: 'b', sortOrder: 9 })
    const missingFolder = summary('missing-folder', { folderId: 'gone', sortOrder: 6 })

    expect(historyChatSections([inA, loose, inB, missingFolder], folders)[0]?.data.map((chat) => chat.id))
      .toEqual(['loose', 'missing-folder'])
    expect(historyChatSections([inA, loose, inB, missingFolder], folders, true)[0]?.data.map((chat) => chat.id))
      .toEqual(['loose', 'missing-folder', 'in-b', 'in-a'])
  })
})

describe('topChatSortOrder', () => {
  const chats = [
    { id: 'loose', pinned: false, folderId: null, sortOrder: 0, createdAt: 1 },
    { id: 'filed', pinned: false, folderId: 'a', sortOrder: -5, createdAt: 1 },
    { id: 'pinned', pinned: true, folderId: null, sortOrder: -9, createdAt: 1 },
  ]

  it('places a chat above every other chat in its destination list', () => {
    expect(topChatSortOrder(chats, new Set(['a']), null)).toBe(-1)
    expect(topChatSortOrder(chats, new Set(['a']), 'a')).toBe(-6)
    expect(topChatSortOrder(chats, new Set(), null)).toBe(-6)
    expect(topChatSortOrder([], new Set(), null)).toBe(0)
    expect(topChatSortOrder(chats, new Set(['a']), null, 'loose')).toBe(0)
  })
})

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
    createdAt: now - 7_200_000,
    pinned: false,
    folderId: null,
    sortOrder: 0,
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
    ['order', { sortOrder: 3 }],
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


describe('large history projection', () => {
  const now = Date.UTC(2026, 8, 7, 12)
  const source = { id: 'a', title: 'A', modelId: 'fixture', updatedAt: now - 1_000, createdAt: now - 1_000,
    pinned: false, folderId: null, sortOrder: 0, expiresAt: null, deletedAt: null, temporary: false }

  it('projects only changed metadata across 5,000 chats and releases removed entries', () => {
    const format = vi.fn(historyChatSummary)
    const project = createHistoryProjector(format)
    const chats = Array.from({ length: 5_000 }, (_, i) => ({ ...source, id: String(i) }))
    const first = project(chats, now)
    format.mockClear()
    expect(project(chats.map((chat) => ({ ...chat, messages: [{ text: 'streaming' }] })), now)).toBe(first)
    expect(format).not.toHaveBeenCalled()
    const renamed = project(chats.map((chat, i) => i === 10 ? { ...chat, title: 'Renamed' } : chat), now)
    expect(format).toHaveBeenCalledTimes(1)
    expect(renamed[9]).toBe(first[9])
    expect(renamed[10].title).toBe('Renamed')
    project([], now)
    format.mockClear()
    project(chats.slice(0, 1), now)
    expect(format).toHaveBeenCalledTimes(1)
  })

  it('preserves ordering and updates expiry, folders, visibility, and date boundaries', () => {
    const project = createHistoryProjector()
    const a = { ...source, updatedAt: now - 86_400_000 + 1 }
    const b = { ...source, id: 'b', pinned: true }
    const first = project([a, b], now)
    expect(project([b, a], now)).toEqual([first[1], first[0]])
    const next = project([{ ...a, folderId: 'folder', expiresAt: now + 1000 }, b], now + 2)
    expect(next[0]).toMatchObject({ section: 'Yesterday', folderId: 'folder', expiresAt: now + 1000 })
    expect(next[0].time).toBe(historyChatSummary(a, now + 2).time)
    expect(project([{ ...a, temporary: true }, { ...b, deletedAt: now }], now)).toEqual([])
    expect(createHistoryProjector()([a], now)[0]).not.toBe(first[0])
  })

  it('groups large sections and folders without changing order or mutating inputs', () => {
    const chats = Array.from({ length: 5000 }, (_, i) => Object.freeze(historyChatSummary({ ...source, id: String(i), folderId: i % 2 ? 'b' : 'a', sortOrder: i }, now)))
    expect(historyChatSections(chats)[0].data).toEqual(chats)
    const folders = historyFolderItems([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }, { id: 'empty', name: 'Empty' }], chats)
    expect(folders.map((f) => f.id)).toEqual(['b', 'a', 'empty'])
    expect(folders[0].chats).toEqual(chats.filter((c) => c.folderId === 'b'))
    expect(folders[1].chats).toEqual(chats.filter((c) => c.folderId === 'a'))
    expect(folders[2].chats).toEqual([])
  })
})
