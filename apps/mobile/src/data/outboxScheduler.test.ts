import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOutboxScheduler } from './outboxScheduler'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('HTTP outbox recovery', () => {
  it('runs and retries while the app is active without requiring a socket', async () => {
    const flush = vi.fn().mockResolvedValueOnce(2_000).mockResolvedValue(null)
    const scheduler = createOutboxScheduler({ isActive: () => true, flush, onError: vi.fn() })
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(flush).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(flush).toHaveBeenCalledTimes(2)
    scheduler.dispose()
  })
  it('pauses in background and resumes when scheduled on foreground', async () => {
    let active = true
    const flush = vi.fn().mockResolvedValue(null)
    const scheduler = createOutboxScheduler({ isActive: () => active, flush, onError: vi.fn() })
    scheduler.schedule()
    active = false
    await vi.advanceTimersByTimeAsync(1_000)
    expect(flush).not.toHaveBeenCalled()
    active = true
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(flush).toHaveBeenCalledOnce()
    scheduler.dispose()
  })
  it('retries unexpected recovery errors and cancels on disposal', async () => {
    const flush = vi.fn().mockRejectedValue(new Error('storage busy'))
    const onError = vi.fn()
    const scheduler = createOutboxScheduler({ isActive: () => true, flush, onError })
    await scheduler.flush()
    expect(onError).toHaveBeenCalledOnce()
    scheduler.dispose()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(flush).toHaveBeenCalledOnce()
  })
  it('does not run overlapping replays', async () => {
    let finish!: (delay: null) => void
    const flush = vi.fn(() => new Promise<null>(resolve => { finish = resolve }))
    const scheduler = createOutboxScheduler({ isActive: () => true, flush, onError: vi.fn() })
    const pending = scheduler.flush()
    await scheduler.flush()
    expect(flush).toHaveBeenCalledOnce()
    finish(null)
    await pending
    scheduler.dispose()
  })
})
