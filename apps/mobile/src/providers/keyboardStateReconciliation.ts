import type { AppStateStatus } from 'react-native'

type Subscription = { remove: () => void }

type KeyboardStateReconciliationDependencies = {
  addAppStateChangeListener: (listener: (state: AppStateStatus) => void) => Subscription
  addKeyboardDidHideListener: (listener: () => void) => Subscription
  addKeyboardDidShowListener: (listener: (height: number) => void) => Subscription
  getKeyboardHeight: () => number | null
  isKeyboardVisible: () => boolean
  reset: () => void
  syncVisible: (height: number) => void
}

export function startKeyboardStateReconciliation({
  addAppStateChangeListener,
  addKeyboardDidHideListener,
  addKeyboardDidShowListener,
  getKeyboardHeight,
  isKeyboardVisible,
  reset,
  syncVisible,
}: KeyboardStateReconciliationDependencies) {
  const reconcile = () => {
    if (!isKeyboardVisible()) {
      reset()
      return
    }

    const height = getKeyboardHeight()
    if (height && height > 0) syncVisible(height)
  }

  const keyboardHideSubscription = addKeyboardDidHideListener(reset)
  const keyboardShowSubscription = addKeyboardDidShowListener((height) => {
    if (height > 0) syncVisible(height)
  })
  const appStateSubscription = addAppStateChangeListener((state) => {
    if (state === 'active') reconcile()
  })

  reconcile()

  return () => {
    keyboardHideSubscription.remove()
    keyboardShowSubscription.remove()
    appStateSubscription.remove()
  }
}
