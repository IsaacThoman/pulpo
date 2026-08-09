import { describe, expect, it } from 'vitest'
import type { PrototypeMessage } from '../domain'
import { reuseProjectedMessages } from './messageReuse'

function message(id: string, text: string, outputItems: unknown[] = []): PrototypeMessage {
  return { id, role: 'assistant', text, createdAt: 1, status: 'complete', outputItems }
}

describe('reuseProjectedMessages', () => {
  it('preserves the array and rows when a projection is equivalent', () => {
    const previous = [message('one', 'same')]
    expect(reuseProjectedMessages(previous, [message('one', 'same')])).toBe(previous)
  })

  it('only replaces the actively changing response', () => {
    const stableOutput = [{ type: 'message', content: 'stable' }]
    const previous = [message('one', 'stable', stableOutput), message('two', 'Hel')]
    const next = reuseProjectedMessages(previous, [message('one', 'stable', stableOutput), message('two', 'Hello')])
    expect(next).not.toBe(previous)
    expect(next[0]).toBe(previous[0])
    expect(next[1]).not.toBe(previous[1])
  })

  it('publishes terminal latency when it becomes available', () => {
    const previous = [message('one', 'done')]
    const next = reuseProjectedMessages(previous, [{ ...message('one', 'done'), latencyMs: 1_250 }])
    expect(next[0]).not.toBe(previous[0])
    expect(next[0]?.latencyMs).toBe(1_250)
  })
})
