export const CHAT_BOTTOM_FOLLOW_THRESHOLD = 96
/** Distance from the tail before offering a jump back to the latest message. */
export const CHAT_SCROLL_TO_BOTTOM_THRESHOLD = 240
/** A reader gesture ending this close to the tail resumes following regardless of direction. */
export const CHAT_RESUME_FOLLOW_THRESHOLD = 24

export type ChatViewportMetrics = {
  offsetY: number
  contentHeight: number
  viewportHeight: number
  inverted?: boolean
  insetTop?: number
}

/** Let unused viewport space absorb the keyboard before moving short transcripts. */
export function chatKeyboardBlankSpace(
  viewportHeight: number,
  contentHeight: number,
): number {
  if (viewportHeight <= 0 || contentHeight <= 0) return 0
  return Math.max(viewportHeight - contentHeight, 0)
}

/** Distance between the viewport and the transcript tail; short transcripts are already there. */
export function chatBottomDistance(metrics: ChatViewportMetrics): number {
  if (metrics.inverted) return metrics.offsetY + (metrics.insetTop ?? 0)
  if (metrics.contentHeight <= metrics.viewportHeight) return 0
  return metrics.contentHeight - metrics.offsetY - metrics.viewportHeight
}

/**
 * Treat short transcripts as already at the end and allow a small tolerance for
 * fractional native layout values near the bottom of longer conversations.
 */
export function isNearChatBottom(
  metrics: ChatViewportMetrics,
  threshold = CHAT_BOTTOM_FOLLOW_THRESHOLD,
): boolean {
  return chatBottomDistance(metrics) <= threshold
}

/**
 * Resume following when a reader gesture ends at the tail, or near it while
 * heading back. A short swipe away from a streaming reply stays detached; the
 * growing reply keeps moving the tail, so returning rarely lands exactly on it.
 */
export function shouldResumeChatFollow(startDistance: number, endDistance: number): boolean {
  if (endDistance <= CHAT_RESUME_FOLLOW_THRESHOLD) return true
  return endDistance <= CHAT_BOTTOM_FOLLOW_THRESHOLD && endDistance < startDistance
}

/**
 * Never move the reader during direct interaction. An explicit tail request,
 * such as submitting a new turn, may override stale proximity measurements.
 */
export function shouldFollowChatContent(
  nearBottom: boolean,
  readerInteracting: boolean,
  forceTail = false,
): boolean {
  return !readerInteracting && (forceTail || nearBottom)
}

/** Keep background chat chrome at its resting position while another surface owns the keyboard. */
export function resolveKeyboardLayoutProgress(progress: number, enabled: boolean): number {
  'worklet'
  return enabled ? progress : 0
}

/** Center the landing identity in the space above the moving composer.
 * Keyboard controller heights are negative; mirror half of the composer's lift.
 * This must not depend on whether suggestion buttons have been laid out.
 */
export function chatLandingKeyboardTranslation(
  keyboardHeight: number,
  keyboardProgress: number,
  composerKeyboardOffset: number,
  enabled: boolean,
): number {
  'worklet'
  return enabled ? Math.min(0, keyboardHeight + keyboardProgress * composerKeyboardOffset) / 2 : 0
}
