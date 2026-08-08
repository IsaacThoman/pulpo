import { describe, expect, it } from 'vitest'
import { canPromoteQueueHead, isTerminalResponseStatus, nextQueuePosition } from './message-queue-policy.js'

describe('message queue policy', () => {
  it('appends after the greatest immutable position', () => {
    expect(nextQueuePosition(undefined)).toBe(0)
    expect(nextQueuePosition(7)).toBe(8)
  })

  it('pauses for editing and failed heads while recovering interrupted dispatches only on request', () => {
    expect(canPromoteQueueHead('pending')).toBe(true)
    expect(canPromoteQueueHead('editing')).toBe(false)
    expect(canPromoteQueueHead('failed')).toBe(false)
    expect(canPromoteQueueHead('dispatching')).toBe(false)
    expect(canPromoteQueueHead('dispatching', true)).toBe(true)
  })

  it('advances after every terminal response outcome', () => {
    for (const status of ['completed', 'cancelled', 'failed', 'incomplete'] as const) {
      expect(isTerminalResponseStatus(status)).toBe(true)
    }
    expect(isTerminalResponseStatus('queued')).toBe(false)
    expect(isTerminalResponseStatus('in_progress')).toBe(false)
  })
})
