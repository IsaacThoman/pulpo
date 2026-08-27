import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchCancellation } from './cancellation.js'

afterEach(() => vi.useRealTimers())

describe('episodic-memory cancellation watcher', () => {
  it('aborts an in-flight operation when cancellation is observed', async () => {
    vi.useFakeTimers()
    const check = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const watcher = watchCancellation(check, 10)
    await vi.advanceTimersByTimeAsync(10)
    expect(watcher.signal.aborted).toBe(true)
    watcher.stop()
  })

  it('stops polling without aborting completed work', async () => {
    vi.useFakeTimers()
    const check = vi.fn().mockResolvedValue(false)
    const watcher = watchCancellation(check, 10)
    await vi.advanceTimersByTimeAsync(0)
    watcher.stop()
    await vi.advanceTimersByTimeAsync(50)
    expect(watcher.signal.aborted).toBe(false)
    expect(check).toHaveBeenCalledTimes(1)
  })
})
