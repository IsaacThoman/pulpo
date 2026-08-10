import { describe, expect, it, vi } from 'vitest'
import { createStreamCloser } from './stream-cleanup.js'

describe('public response stream cleanup', () => {
  it('disconnects the subscriber and ends the reply exactly once', () => {
    const subscriber = { disconnect: vi.fn() }
    const reply = { writableEnded: false, end: vi.fn() }
    const close = createStreamCloser(subscriber, reply)

    close()
    close()

    expect(subscriber.disconnect).toHaveBeenCalledTimes(1)
    expect(reply.end).toHaveBeenCalledTimes(1)
  })

  it('does not end an already-ended reply', () => {
    const subscriber = { disconnect: vi.fn() }
    const reply = { writableEnded: true, end: vi.fn() }
    const close = createStreamCloser(subscriber, reply)

    close()

    expect(subscriber.disconnect).toHaveBeenCalledTimes(1)
    expect(reply.end).not.toHaveBeenCalled()
  })

  it('stays idempotent when ending the reply emits close synchronously', () => {
    const subscriber = { disconnect: vi.fn() }
    let close: () => void
    const reply = { writableEnded: false, end: vi.fn(() => close()) }
    close = createStreamCloser(subscriber, reply)

    close()

    expect(subscriber.disconnect).toHaveBeenCalledTimes(1)
    expect(reply.end).toHaveBeenCalledTimes(1)
  })
})
