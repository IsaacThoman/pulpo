export const CHAT_BOTTOM_FOLLOW_THRESHOLD = 96

export type ChatViewportMetrics = {
  offsetY: number
  contentHeight: number
  viewportHeight: number
}

/**
 * Treat short transcripts as already at the end and allow a small tolerance for
 * fractional native layout values near the bottom of longer conversations.
 */
export function isNearChatBottom(
  metrics: ChatViewportMetrics,
  threshold = CHAT_BOTTOM_FOLLOW_THRESHOLD,
): boolean {
  if (metrics.contentHeight <= metrics.viewportHeight) return true
  return metrics.offsetY + metrics.viewportHeight >= metrics.contentHeight - threshold
}

/** Never move the reader while a drag or its momentum is still in progress. */
export function shouldFollowChatContent(nearBottom: boolean, readerInteracting: boolean): boolean {
  return nearBottom && !readerInteracting
}

/** Keep background chat chrome at its resting position while another surface owns the keyboard. */
export function resolveKeyboardLayoutProgress(progress: number, enabled: boolean): number {
  'worklet'
  return enabled ? progress : 0
}
