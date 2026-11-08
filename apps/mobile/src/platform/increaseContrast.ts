import { useSyncExternalStore } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'

// iOS's Increase Contrast setting, which UIKit calls "darker system colors".
let enabled = false
const listeners = new Set<() => void>()

function update(value: boolean) {
  if (value === enabled) return
  enabled = value
  for (const listener of listeners) listener()
}

if (Platform.OS === 'ios' && typeof AccessibilityInfo?.isDarkerSystemColorsEnabled === 'function') {
  void AccessibilityInfo.isDarkerSystemColorsEnabled().then(update, () => undefined)
  AccessibilityInfo.addEventListener('darkerSystemColorsChanged', update)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Whether Increase Contrast is on, so the app's own colors can follow it as system colors do. */
export function useIncreaseContrast(): boolean {
  return useSyncExternalStore(subscribe, () => enabled, () => false)
}
