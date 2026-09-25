import { expect, it } from 'vitest'
import { BranchHistoryCache } from './branch-history-cache'
import type { ServerChat } from '@/stores/chat'

function chat(leaf: string, text = 'answer'): ServerChat {
  return { activeBranchLeafId: leaf, activeResponseId: leaf, history: { offset: 0, hasMore: false, before: leaf, leafId: leaf },
    responses: [{ id: leaf, output: text }], attachments: [] } as unknown as ServerChat
}

it('retains recent windows within both count and serialized size limits', () => {
  const owner = {}, cache = new BranchHistoryCache(1000, 2)
  cache.remember(owner, chat('a'))
  cache.remember(owner, chat('b'))
  expect(cache.find(owner, 'a')?.activeBranchLeafId).toBe('a')
  cache.remember(owner, chat('c'))
  expect(cache.find(owner, 'b')).toBeUndefined()
  cache.remember(owner, chat('huge', 'x'.repeat(1000)))
  expect(cache.find(owner, 'huge')).toBeUndefined()
  expect(cache.find(owner, 'a')).toBeDefined()
  cache.remember(owner, chat('medium', 'x'.repeat(450)))
  expect(cache.find(owner, 'a')).toBeUndefined()
  expect(cache.find(owner, 'medium')).toBeDefined()
})

it('scopes windows to query identity and releases discarded accounts/chats', () => {
  const first = {}, second = {}, cache = new BranchHistoryCache()
  cache.remember(first, chat('a'))
  expect(cache.find(second, 'a')).toBeUndefined()
  cache.remember(second, chat('b'))
  cache.delete(first)
  expect(cache.find(first, 'a')).toBeUndefined()
  expect(cache.find(second, 'b')).toBeDefined()
})
