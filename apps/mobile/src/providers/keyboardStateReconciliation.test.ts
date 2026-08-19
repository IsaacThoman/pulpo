import { describe, expect, it, vi } from 'vitest'
import type { AppStateStatus } from 'react-native'
import { startKeyboardStateReconciliation } from './keyboardStateReconciliation'

function createHarness(initiallyVisible: boolean, initialHeight: number | null = initiallyVisible ? 320 : null) {
  let appStateListener: ((state: AppStateStatus) => void) | undefined
  let keyboardDidHideListener: (() => void) | undefined
  let keyboardDidShowListener: ((height: number) => void) | undefined
  let visible = initiallyVisible
  let height = initialHeight
  const reset = vi.fn()
  const syncVisible = vi.fn()
  const removeAppStateListener = vi.fn()
  const removeKeyboardHideListener = vi.fn()
  const removeKeyboardShowListener = vi.fn()

  const stop = startKeyboardStateReconciliation({
    addAppStateChangeListener: (listener) => {
      appStateListener = listener
      return { remove: removeAppStateListener }
    },
    addKeyboardDidHideListener: (listener) => {
      keyboardDidHideListener = listener
      return { remove: removeKeyboardHideListener }
    },
    addKeyboardDidShowListener: (listener) => {
      keyboardDidShowListener = listener
      return { remove: removeKeyboardShowListener }
    },
    getKeyboardHeight: () => height,
    isKeyboardVisible: () => visible,
    reset,
    syncVisible,
  })

  return {
    appStateChange: (state: AppStateStatus) => appStateListener?.(state),
    keyboardDidHide: () => keyboardDidHideListener?.(),
    keyboardDidShow: (nextHeight: number) => keyboardDidShowListener?.(nextHeight),
    removeAppStateListener,
    removeKeyboardHideListener,
    removeKeyboardShowListener,
    reset,
    setHeight: (nextHeight: number | null) => { height = nextHeight },
    setVisible: (nextVisible: boolean) => { visible = nextVisible },
    stop,
    syncVisible,
  }
}

describe('keyboard state reconciliation', () => {
  it('resets stale state on mount and whenever the keyboard hides', () => {
    const harness = createHarness(false)

    expect(harness.reset).toHaveBeenCalledTimes(1)
    harness.keyboardDidHide()
    expect(harness.reset).toHaveBeenCalledTimes(2)
  })

  it('synchronizes an already-visible keyboard on mount and foreground', () => {
    const harness = createHarness(true)

    expect(harness.syncVisible).toHaveBeenCalledWith(320)
    harness.setHeight(360)
    harness.appStateChange('active')
    expect(harness.syncVisible).toHaveBeenLastCalledWith(360)
    expect(harness.syncVisible).toHaveBeenCalledTimes(2)
    expect(harness.reset).not.toHaveBeenCalled()

    harness.setVisible(false)
    harness.appStateChange('active')
    expect(harness.reset).toHaveBeenCalledTimes(1)
  })

  it('synchronizes from the native show event when startup metrics were unavailable', () => {
    const harness = createHarness(true, null)

    expect(harness.syncVisible).not.toHaveBeenCalled()
    harness.keyboardDidShow(340)
    expect(harness.syncVisible).toHaveBeenCalledWith(340)
  })

  it('does not reconcile on inactive or background transitions', () => {
    const harness = createHarness(true)
    harness.setVisible(false)

    harness.appStateChange('inactive')
    harness.appStateChange('background')
    expect(harness.reset).not.toHaveBeenCalled()
  })

  it('removes all listeners when stopped', () => {
    const harness = createHarness(true)

    harness.stop()
    expect(harness.removeKeyboardHideListener).toHaveBeenCalledOnce()
    expect(harness.removeKeyboardShowListener).toHaveBeenCalledOnce()
    expect(harness.removeAppStateListener).toHaveBeenCalledOnce()
  })
})
