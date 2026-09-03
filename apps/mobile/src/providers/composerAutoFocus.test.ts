import { describe, expect, it, vi } from 'vitest'
import { shouldAutoFocusComposer, startComposerAutoFocus, startComposerFocusRequest } from './composerAutoFocus'

function createHarness() {
  const frames = new Map<number, () => void>()
  let nextFrame = 1
  const cancelFrame = vi.fn((frame: number) => { frames.delete(frame) })
  const focus = vi.fn()
  const scheduleFrame = vi.fn((listener: () => void) => {
    const frame = nextFrame
    nextFrame += 1
    frames.set(frame, listener)
    return frame
  })
  const stop = startComposerAutoFocus({ cancelFrame, focus, scheduleFrame })
  const flushNextFrame = () => {
    const next = frames.entries().next().value as [number, () => void] | undefined
    if (!next) return
    frames.delete(next[0])
    next[1]()
  }

  return { cancelFrame, focus, flushNextFrame, scheduleFrame, stop }
}

describe('composer auto focus', () => {
  it('only auto-focuses an unsaved new chat', () => {
    expect(shouldAutoFocusComposer(null)).toBe(true)
    expect(shouldAutoFocusComposer('existing-chat')).toBe(false)
  })

  it('waits two frames before focusing the input', () => {
    const harness = createHarness()

    harness.flushNextFrame()
    expect(harness.focus).not.toHaveBeenCalled()
    harness.flushNextFrame()
    expect(harness.focus).toHaveBeenCalledOnce()
  })

  it('cancels focus when the composer unmounts during startup', () => {
    const harness = createHarness()

    harness.flushNextFrame()
    harness.stop()
    harness.flushNextFrame()

    expect(harness.focus).not.toHaveBeenCalled()
    expect(harness.cancelFrame).toHaveBeenCalledTimes(2)
  })

  it('blurs immediately when an existing chat requests focus release', () => {
    const blur = vi.fn()
    const focus = vi.fn()
    const scheduleFrame = vi.fn()

    startComposerFocusRequest('blur', {
      blur,
      cancelFrame: vi.fn(),
      focus,
      scheduleFrame,
    })

    expect(blur).toHaveBeenCalledOnce()
    expect(focus).not.toHaveBeenCalled()
    expect(scheduleFrame).not.toHaveBeenCalled()
  })

  it('uses delayed auto-focus when a new chat requests composer focus', () => {
    const frames: Array<() => void> = []
    const blur = vi.fn()
    const focus = vi.fn()

    startComposerFocusRequest('focus', {
      blur,
      cancelFrame: vi.fn(),
      focus,
      scheduleFrame: (listener) => {
        frames.push(listener)
        return frames.length
      },
    })

    frames.shift()?.()
    expect(focus).not.toHaveBeenCalled()
    frames.shift()?.()
    expect(focus).toHaveBeenCalledOnce()
    expect(blur).not.toHaveBeenCalled()
  })
})
