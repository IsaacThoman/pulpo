import { describe, expect, it } from 'vitest'
import type { Chat } from './types'
import { reconcileStreamingResponseIds, reindexDetailedChatResponses } from './response-tracking'

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
})
