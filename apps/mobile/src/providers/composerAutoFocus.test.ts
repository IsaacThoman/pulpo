import { describe, expect, it, vi } from 'vitest'
import { startComposerAutoFocus, startComposerFocusTransition } from './composerAutoFocus'

function createHarness(autoStart = true) {
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
  const stop = autoStart
    ? startComposerAutoFocus({ cancelFrame, focus, scheduleFrame })
    : () => undefined
  const flushNextFrame = () => {
    const next = frames.entries().next().value as [number, () => void] | undefined
    if (!next) return
    frames.delete(next[0])
    next[1]()
  }

  return { cancelFrame, focus, flushNextFrame, scheduleFrame, stop }
}

describe('composer auto focus', () => {
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

  it('blurs the composer when opening existing chat content', () => {
    const blur = vi.fn()
    const dismissKeyboard = vi.fn()
    const focus = vi.fn()
    const scheduleFrame = vi.fn()

    startComposerFocusTransition({
      blur,
      cancelFrame: vi.fn(),
      dismissKeyboard,
      focus,
      scheduleFrame,
      target: 'content',
    })

    expect(blur).toHaveBeenCalledOnce()
    expect(dismissKeyboard).toHaveBeenCalledOnce()
    expect(focus).not.toHaveBeenCalled()
    expect(scheduleFrame).not.toHaveBeenCalled()
  })

  it('focuses the composer after two frames when opening a new chat', () => {
    const harness = createHarness(false)
    const blur = vi.fn()
    const dismissKeyboard = vi.fn()

    startComposerFocusTransition({
      blur,
      cancelFrame: harness.cancelFrame,
      dismissKeyboard,
      focus: harness.focus,
      scheduleFrame: harness.scheduleFrame,
      target: 'composer',
    })

    harness.flushNextFrame()
    harness.flushNextFrame()

    expect(harness.focus).toHaveBeenCalledOnce()
    expect(blur).not.toHaveBeenCalled()
    expect(dismissKeyboard).not.toHaveBeenCalled()
  })
})
