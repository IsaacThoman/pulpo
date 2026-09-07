import { describe, expect, it, vi } from 'vitest'
import {
  createHistoryProjector,
  historyFolderItems,
  historyChatSections,
  historyChatSummary,
  resolveHistoryChatExpiryMenuAction,
  reuseHistoryChatSummaries,
  visibleHistoryChats,
} from './history'

describe('historyChatSections', () => {
  it('always places pinned chats in the first section', () => {
    const newerUnpinned = {
      id: 'newer', title: 'Newer', modelId: 'gpt-5', time: '1:00 PM', section: 'Today',
      pinned: false, folderId: null, expiresAt: null,
    }
    const olderPinned = {
      id: 'pinned', title: 'Pinned', modelId: 'gpt-5', time: 'Aug 1', section: 'Pinned',
      pinned: true, folderId: null, expiresAt: null,
    }

    const sections = historyChatSections([newerUnpinned, olderPinned])

    expect(sections.map((section) => section.title)).toEqual(['Pinned', 'Today'])
    expect(sections[0]?.data).toEqual([olderPinned])
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


describe('large history projection', () => {
  const now = Date.UTC(2026, 8, 7, 12)
  const source = { id: 'a', title: 'A', modelId: 'fixture', updatedAt: now - 1_000,
    pinned: false, folderId: null, expiresAt: null, deletedAt: null, temporary: false }

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
    const chats = Array.from({ length: 5000 }, (_, i) => Object.freeze(historyChatSummary({ ...source, id: String(i), folderId: i % 2 ? 'b' : 'a' }, now)))
    expect(historyChatSections(chats)[0].data).toEqual(chats)
    const folders = historyFolderItems([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }, { id: 'empty', name: 'Empty' }], chats)
    expect(folders.map((f) => f.id)).toEqual(['b', 'a', 'empty'])
    expect(folders[0].chats).toEqual(chats.filter((c) => c.folderId === 'b'))
    expect(folders[1].chats).toEqual(chats.filter((c) => c.folderId === 'a'))
    expect(folders[2].chats).toEqual([])
  })
})
