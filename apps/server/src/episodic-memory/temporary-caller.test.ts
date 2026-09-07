import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('../chats/memory-policy.js', () => ({ chatCanAccessMemory: vi.fn() }))
vi.mock('./indexer.js', () => ({ userMemoryIsEnabled: vi.fn(), activeGeneration: vi.fn() }))
import { chatCanAccessMemory } from '../chats/memory-policy.js'
import { userMemoryIsEnabled } from './indexer.js'
import { searchEpisodicChats } from './retrieval.js'
import { readEpisodicChatPage } from './agent-tools.js'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(chatCanAccessMemory).mockResolvedValue(false)
  vi.mocked(userMemoryIsEnabled).mockResolvedValue(true)
})
it.each(['automatic', 'explicit'] as const)('blocks %s recall from a temporary caller before accessing account memory', async (purpose) => {
  expect(await searchEpisodicChats({ userId: 'user', currentChatId: 'temporary', query: 'secret submarine', purpose })).toEqual([])
  expect(chatCanAccessMemory).toHaveBeenCalledWith('user', 'temporary')
  expect(userMemoryIsEnabled).not.toHaveBeenCalled()
})
it('blocks read_chat from a temporary caller', async () => {
  expect(await readEpisodicChatPage({ userId: 'user', currentChatId: 'temporary', chatId: 'normal', maxOutputBytes: 4_096 })).toBeNull()
  expect(chatCanAccessMemory).toHaveBeenCalledWith('user', 'temporary')
  expect(userMemoryIsEnabled).not.toHaveBeenCalled()
})
