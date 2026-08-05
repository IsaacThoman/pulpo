import { describe, expect, it } from 'vitest'
import type { Chat } from './types'
import {
  chatHasStreamingResponse,
  mergeSummaryResponseTracking,
  reconcileStreamingResponseIds,
  reindexDetailedChatResponses,
} from './response-tracking'

const chat: Chat = {
  id: 'chat-1',
  title: 'Branches',
  modelId: 'model',
  messages: [
    { id: 'visible', role: 'assistant', content: 'done', timestamp: 0, done: true },
  ],
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  folderId: null,
  sortOrder: 0,
  tags: [],
}

describe('response tracking', () => {
  it('discovers in-flight response ownership from chat summaries', () => {
    const tracked = mergeSummaryResponseTracking(
      [{ id: 'chat-1', inFlightResponseIds: ['queued', 'running'] }, { id: 'chat-2' }],
      ['local'],
      { local: 'chat-2' },
    )

    expect(tracked).toEqual({
      streamingIds: ['local', 'queued', 'running'],
      responseChatIds: { local: 'chat-2', queued: 'chat-1', running: 'chat-1' },
    })
    expect(chatHasStreamingResponse('chat-1', tracked.streamingIds, tracked.responseChatIds)).toBe(true)
    expect(chatHasStreamingResponse('chat-3', tracked.streamingIds, tracked.responseChatIds)).toBe(false)
  })

  it('tracks hidden in-flight sibling responses from detailed chat data', () => {
    const detail = { responses: [
      { id: 'visible', status: 'completed' },
      { id: 'hidden-stream', status: 'in_progress' },
    ] }

    expect(reconcileStreamingResponseIds([chat], [], detail)).toEqual(['hidden-stream'])
    expect(reindexDetailedChatResponses({}, chat, detail)).toEqual({
      visible: 'chat-1',
      'hidden-stream': 'chat-1',
    })
  })

  it('removes a hidden response from streaming state when its terminal detail arrives', () => {
    const detail = { responses: [
      { id: 'visible', status: 'completed' },
      { id: 'hidden-stream', status: 'completed' },
    ] }

    expect(reconcileStreamingResponseIds([chat], ['hidden-stream'], detail)).toEqual([])
  })

  it('keeps known hidden response ownership when a stale detail omits it', () => {
    expect(reindexDetailedChatResponses(
      { 'hidden-stream': 'chat-1' },
      chat,
      { responses: [{ id: 'visible', status: 'completed' }] },
    )).toEqual({
      visible: 'chat-1',
      'hidden-stream': 'chat-1',
    })
  })
})
