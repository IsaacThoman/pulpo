import { useEffect, useRef } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'

/**
 * Speaks `message` with the screen reader. On iOS it waits for current speech to finish (queued),
 * so an announcement does not cut off the label of the control the user just activated.
 */
export function announce(message: string) {
  if (!message) return
  if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true })
  else AccessibilityInfo.announceForAccessibility(message)
}

/**
 * Announces `message` whenever it changes to a new non-empty value, as an ARIA live region would.
 * iOS ignores `accessibilityRole="alert"` and `accessibilityLiveRegion`, so errors and status text
 * that appear on screen must be announced explicitly. Clearing the message (null, undefined or '')
 * re-arms it, so the same text appearing again is announced again.
 */
export function useAccessibilityAnnouncement(message: string | null | undefined | false) {
  const previous = useRef<string | null>(null)
  const next = message || null
  useEffect(() => {
    if (next === previous.current) return
    previous.current = next
    if (next) announce(next)
  }, [next])
}
