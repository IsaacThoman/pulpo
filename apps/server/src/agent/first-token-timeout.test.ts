import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFirstTokenTimeout } from './first-token-timeout.js'

afterEach(() => vi.useRealTimers())

describe('Agent first-token timeout', () => {
  it('aborts a model turn that produces no token before the deadline', () => {
    vi.useFakeTimers()
    const timeout = createFirstTokenTimeout(true, 30)
    vi.advanceTimersByTime(30_000)
    expect(timeout.signal?.aborted).toBe(true)
    expect(timeout.signal?.reason).toEqual(new Error('First-token timeout'))
  })

  it('stops the deadline after the first token', () => {
    vi.useFakeTimers()
    const timeout = createFirstTokenTimeout(true, 30)
    timeout.clear()
    vi.advanceTimersByTime(30_000)
    expect(timeout.signal?.aborted).toBe(false)
  })

  it('preserves Agent cancellation when the timeout is disabled', () => {
    const parent = new AbortController()
    const timeout = createFirstTokenTimeout(false, 30, parent.signal)
    parent.abort()
    expect(timeout.signal?.aborted).toBe(true)
  })
})
