import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RelatedChat } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('../../api/client', () => ({ apiRequest: mocks.apiRequest }))

import {
  createSideChat,
  fetchRelatedChats,
  forkChat,
  isAsideChat,
  isListedChat,
  latestSettledReplyId,
  messageResponseId,
  originLabel,
  relatedChatSections,
  relatedChatsLabel,
  replySettled,
  setThreadResolved,
} from './threads'


function related(id: string, kind: RelatedChat['kind'], status: RelatedChat['status'] = null): RelatedChat {
  return {
    id, kind, title: id, status, summary: null,
    createdAt: '2026-11-18T00:00:00.000Z', updatedAt: '2026-11-18T00:00:00.000Z',
  }
}

beforeEach(() => {
  mocks.apiRequest.mockReset().mockResolvedValue({})
})

describe('thread API', () => {
  it('reads a chat’s related chats', async () => {
    const signal = new AbortController().signal
    await fetchRelatedChats('chat-1', signal)
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/chats/chat-1/related', { signal })
  })

  it('opens a side chat at a reply, or at the latest reply when none is given', async () => {
    await createSideChat('chat-1', { responseId: 'response-1', clientId: 'side-1' })
    expect(mocks.apiRequest).toHaveBeenLastCalledWith('/api/chats/chat-1/side-chats', {
      method: 'POST', body: { clientId: 'side-1', responseId: 'response-1' },
    })
    await createSideChat('chat-1', { responseId: null })
    expect(mocks.apiRequest).toHaveBeenLastCalledWith('/api/chats/chat-1/side-chats', { method: 'POST', body: {} })
  })

  it('forks from a reply', async () => {
    await forkChat('response-1', { clientId: 'fork-1' })
    expect(mocks.apiRequest).toHaveBeenLastCalledWith('/api/messages/response-1/fork', { method: 'POST', body: { clientId: 'fork-1' } })
  })

  it('resolves and reopens a thread', async () => {
    await setThreadResolved('thread-1', true)
    expect(mocks.apiRequest).toHaveBeenLastCalledWith('/api/chats/thread-1/thread', { method: 'PATCH', body: { resolved: true } })
    await setThreadResolved('thread-1', false)
    expect(mocks.apiRequest).toHaveBeenLastCalledWith('/api/chats/thread-1/thread', { method: 'PATCH', body: { resolved: false } })
  })
})

describe('chat kinds', () => {
  it('lists ordinary chats and forks, but not side chats or threads', () => {
    expect(isListedChat({})).toBe(true)
    expect(isListedChat({ kind: 'chat' })).toBe(true)
    expect(isListedChat({ kind: 'side' })).toBe(false)
    expect(isAsideChat({ kind: 'thread' })).toBe(true)
  })

  it('says where a chat came from', () => {
    expect(originLabel({ kind: 'side', originChatId: 'chat-1' })).toBe('Side chat from')
    expect(originLabel({ kind: 'thread', originChatId: 'chat-1' })).toBe('Thread from')
    expect(originLabel({ kind: 'chat', originChatId: 'chat-1' })).toBe('Forked from')
    expect(originLabel({ kind: 'chat', originChatId: null })).toBeNull()
    expect(originLabel({})).toBeNull()
  })

  it('finds the response a transcript message belongs to', () => {
    expect(messageResponseId('response-1:input')).toBe('response-1')
    expect(messageResponseId('response-1')).toBe('response-1')
  })

  it('only offers settled replies', () => {
    expect(replySettled('complete')).toBe(true)
    expect(replySettled('failed')).toBe(true)
    expect(replySettled(undefined)).toBe(true)
    expect(replySettled('streaming')).toBe(false)
    expect(replySettled('queued')).toBe(false)
  })
})

describe('related chats', () => {
  const value = {
    threads: [related('done', 'thread', 'done'), related('working', 'thread', 'working'), related('failed', 'thread', 'attention'), related('resolved', 'thread', 'resolved')],
    sideChats: [related('side', 'side')],
  }

  it('lists threads that need the user first, then by status, then side chats', () => {
    expect(relatedChatSections(value).map((section) => [section.title, section.data.map((chat) => chat.id)])).toEqual([
      ['Needs attention', ['failed']],
      ['Working', ['working']],
      ['Done', ['done']],
      ['Resolved', ['resolved']],
      ['Side chats', ['side']],
    ])
  })

  it('labels the entry point by what the chat has', () => {
    expect(relatedChatsLabel(value)).toBe('4 threads · 1 working · 1 side chat')
    expect(relatedChatsLabel({ threads: [related('a', 'thread', 'done'), related('b', 'thread', 'resolved')], sideChats: [] })).toBe('2 threads · 1 open')
    expect(relatedChatsLabel({ threads: [related('a', 'thread', 'done')], sideChats: [] })).toBe('1 thread')
    expect(relatedChatsLabel({ threads: [], sideChats: [related('a', 'side'), related('b', 'side')] })).toBe('2 side chats')
    expect(relatedChatsLabel({ threads: [], sideChats: [] })).toBeNull()
    expect(relatedChatsLabel(undefined)).toBeNull()
  })
})


describe('latestSettledReplyId', () => {
  it('forks from the latest reply only once it has settled', () => {
    expect(latestSettledReplyId([
      { id: 'r1:input', role: 'user' }, { id: 'r1', role: 'assistant', status: 'complete' },
      { id: 'r2:input', role: 'user' }, { id: 'r2', role: 'assistant', status: 'stopped' },
    ])).toBe('r2')
    expect(latestSettledReplyId([
      { id: 'r1', role: 'assistant', status: 'complete' }, { id: 'r2', role: 'assistant', status: 'streaming' },
    ])).toBeNull()
    expect(latestSettledReplyId([])).toBeNull()
  })
})
