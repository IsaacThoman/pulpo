import { describe, expect, it, vi } from 'vitest'
import { KEYBOARD_HANDOFF_FALLBACK_MS, startAuthKeyboardHandoff } from './keyboardHandoff'

function createHarness(initiallyVisible: boolean) {
  let keyboardDidHideListener: (() => void) | undefined
  let fallbackListener: (() => void) | undefined
  const cancelFallback = vi.fn()
  const dismissKeyboard = vi.fn()
  const onComplete = vi.fn()
  const removeKeyboardListener = vi.fn()
  const scheduleFallback = vi.fn((listener: () => void) => {
    fallbackListener = listener
    return cancelFallback
  })

  const stop = startAuthKeyboardHandoff({
    addKeyboardDidHideListener: (listener) => {
      keyboardDidHideListener = listener
      return { remove: removeKeyboardListener }
    },
    dismissKeyboard,
    isKeyboardVisible: () => initiallyVisible,
    onComplete,
    scheduleFallback,
  })

  return {
    cancelFallback,
    dismissKeyboard,
    fallback: () => fallbackListener?.(),
    keyboardDidHide: () => keyboardDidHideListener?.(),
    onComplete,
    removeKeyboardListener,
    scheduleFallback,
    stop,
  }
}

describe('auth keyboard handoff', () => {
  it('completes immediately when authentication did not leave a keyboard visible', () => {
    const harness = createHarness(false)

    expect(harness.onComplete).toHaveBeenCalledOnce()
    expect(harness.dismissKeyboard).not.toHaveBeenCalled()
    expect(harness.scheduleFallback).not.toHaveBeenCalled()
  })

  it('dismisses a visible keyboard before completing the handoff', () => {
    const harness = createHarness(true)

    expect(harness.dismissKeyboard).toHaveBeenCalledOnce()
    expect(harness.scheduleFallback).toHaveBeenCalledWith(expect.any(Function), KEYBOARD_HANDOFF_FALLBACK_MS)
    expect(harness.onComplete).not.toHaveBeenCalled()

    harness.keyboardDidHide()

    expect(harness.onComplete).toHaveBeenCalledOnce()
    expect(harness.removeKeyboardListener).toHaveBeenCalledOnce()
    expect(harness.cancelFallback).toHaveBeenCalledOnce()
  })

  it('uses the fallback when the native hide notification is lost', () => {
    const harness = createHarness(true)

    harness.fallback()

    expect(harness.onComplete).toHaveBeenCalledOnce()
    expect(harness.removeKeyboardListener).toHaveBeenCalledOnce()
    expect(harness.cancelFallback).toHaveBeenCalledOnce()
  })

  it('cleans up without completing when the session changes mid-handoff', () => {
    const harness = createHarness(true)

    harness.stop()
    harness.keyboardDidHide()
    harness.fallback()

    expect(harness.onComplete).not.toHaveBeenCalled()
    expect(harness.removeKeyboardListener).toHaveBeenCalledOnce()
    expect(harness.cancelFallback).toHaveBeenCalledOnce()
  })
})
