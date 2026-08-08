import type { AppStateStatus } from 'react-native'

type Subscription = { remove: () => void }

type KeyboardStateReconciliationDependencies = {
  addAppStateChangeListener: (listener: (state: AppStateStatus) => void) => Subscription
  addKeyboardDidHideListener: (listener: () => void) => Subscription
  isKeyboardVisible: () => boolean
  reset: () => void
}

export function startKeyboardStateReconciliation({
  addAppStateChangeListener,
  addKeyboardDidHideListener,
  isKeyboardVisible,
  reset,
}: KeyboardStateReconciliationDependencies) {
  const resetIfKeyboardHidden = () => {
    if (!isKeyboardVisible()) reset()
  }

  const keyboardSubscription = addKeyboardDidHideListener(reset)
  const appStateSubscription = addAppStateChangeListener((state) => {
    if (state === 'active') resetIfKeyboardHidden()
  })

  resetIfKeyboardHidden()

  return () => {
    keyboardSubscription.remove()
    appStateSubscription.remove()
  }
}
