type Subscription = { remove: () => void }

export const KEYBOARD_HANDOFF_FALLBACK_MS = 750

type KeyboardHandoffDependencies = {
  addKeyboardDidHideListener: (listener: () => void) => Subscription
  dismissKeyboard: () => void
  isKeyboardVisible: () => boolean
  onComplete: () => void
  scheduleFallback: (listener: () => void, delayMs: number) => () => void
}

/**
 * Fully closes an auth-owned keyboard before an auto-focused member screen mounts.
 * This gives keyboard-aware views a fresh show event instead of inheriting an
 * already-visible keyboard whose animation state may still be closed.
 */
export function startAuthKeyboardHandoff({
  addKeyboardDidHideListener,
  dismissKeyboard,
  isKeyboardVisible,
  onComplete,
  scheduleFallback,
}: KeyboardHandoffDependencies) {
  if (!isKeyboardVisible()) {
    onComplete()
    return () => undefined
  }

  let active = true
  let keyboardSubscription: Subscription | null = null
  let cancelFallback: (() => void) | null = null

  const complete = () => {
    if (!active) return
    active = false
    keyboardSubscription?.remove()
    cancelFallback?.()
    onComplete()
  }

  keyboardSubscription = addKeyboardDidHideListener(complete)
  cancelFallback = scheduleFallback(complete, KEYBOARD_HANDOFF_FALLBACK_MS)
  dismissKeyboard()

  return () => {
    if (!active) return
    active = false
    keyboardSubscription?.remove()
    cancelFallback?.()
  }
}
