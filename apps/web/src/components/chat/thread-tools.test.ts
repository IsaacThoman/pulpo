import { describe, expect, it } from 'vitest'
import { startedThreadId, startedThreadTools } from './thread-tools'

const threadId = '00000000-0000-4000-8000-0000000000c1'

describe('startedThreadId', () => {
  it('prefers the item field and falls back to the id in the output', () => {
    expect(startedThreadId({ threadId, output: 'thread_id: 00000000-0000-4000-8000-000000000000' })).toBe(threadId)
    expect(startedThreadId({ output: `Started thread “X” (thread_id: ${threadId.toUpperCase()}).` })).toBe(threadId)
    expect(startedThreadId({ output: 'Started.' })).toBeNull()
  })
})

describe('startedThreadTools', () => {
  it('keeps start_thread calls that started or are starting a thread', () => {
    const running = { type: 'pulpo_tool', id: 'a', tool: 'start_thread', status: 'running' }
    const started = { type: 'pulpo_tool', id: 'b', tool: 'start_thread', status: 'completed', threadId }
    const failed = { type: 'pulpo_tool', id: 'c', tool: 'start_thread', status: 'failed', output: 'At most 6 threads' }
    const other = { type: 'pulpo_tool', id: 'd', tool: 'list_threads', status: 'completed', output: `thread_id: ${threadId}` }
    expect(startedThreadTools([running, started, failed, other, { type: 'message' }]).map((tool) => tool.id)).toEqual(['a', 'b'])
  })
})
