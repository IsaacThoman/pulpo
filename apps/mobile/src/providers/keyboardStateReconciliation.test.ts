import { describe, expect, it, vi } from 'vitest'
import type { AppStateStatus } from 'react-native'
import { startKeyboardStateReconciliation } from './keyboardStateReconciliation'

function createHarness(initiallyVisible: boolean) {
  let appStateListener: ((state: AppStateStatus) => void) | undefined
  let keyboardDidHideListener: (() => void) | undefined
  let visible = initiallyVisible
  const reset = vi.fn()
  const removeAppStateListener = vi.fn()
  const removeKeyboardListener = vi.fn()

  const stop = startKeyboardStateReconciliation({
    addAppStateChangeListener: (listener) => {
      appStateListener = listener
      return { remove: removeAppStateListener }
    },
    addKeyboardDidHideListener: (listener) => {
      keyboardDidHideListener = listener
      return { remove: removeKeyboardListener }
    },
    isKeyboardVisible: () => visible,
    reset,
  })

  return {
    appStateChange: (state: AppStateStatus) => appStateListener?.(state),
    keyboardDidHide: () => keyboardDidHideListener?.(),
    removeAppStateListener,
    removeKeyboardListener,
    reset,
    setVisible: (nextVisible: boolean) => { visible = nextVisible },
    stop,
  }
}

describe('keyboard state reconciliation', () => {
  it('resets stale state on mount and whenever the keyboard hides', () => {
    const harness = createHarness(false)

    expect(harness.reset).toHaveBeenCalledTimes(1)
    harness.keyboardDidHide()
    expect(harness.reset).toHaveBeenCalledTimes(2)
  })

  it('resets on foreground only when the keyboard is not visible', () => {
    const harness = createHarness(true)

    harness.appStateChange('active')
    expect(harness.reset).not.toHaveBeenCalled()

    harness.setVisible(false)
    harness.appStateChange('active')
    expect(harness.reset).toHaveBeenCalledTimes(1)
  })

  it('does not reconcile on inactive or background transitions', () => {
    const harness = createHarness(true)
    harness.setVisible(false)

    harness.appStateChange('inactive')
    harness.appStateChange('background')
    expect(harness.reset).not.toHaveBeenCalled()
  })

  it('removes both listeners when stopped', () => {
    const harness = createHarness(true)

    harness.stop()
    expect(harness.removeKeyboardListener).toHaveBeenCalledOnce()
    expect(harness.removeAppStateListener).toHaveBeenCalledOnce()
  })
})
