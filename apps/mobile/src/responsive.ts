export const COMPACT_WINDOW_MAX = 699
export const PERSISTENT_SIDEBAR_MIN = 800
export const SIDEBAR_WIDTH = 300
export const DRAWER_MAX_WIDTH = 360
export const DRAWER_TRAILING_PEEK = 52
export const CHAT_CONTENT_MAX = 840
export const FORM_CONTENT_MAX = 620
export const SETTINGS_CONTENT_MAX = 760

export type WindowSizeClass = 'compact' | 'medium' | 'wide'

export function windowSizeClass(width: number): WindowSizeClass {
  if (width <= COMPACT_WINDOW_MAX) return 'compact'
  if (width < PERSISTENT_SIDEBAR_MIN) return 'medium'
  return 'wide'
}

export function usesPersistentSidebar(width: number): boolean {
  return windowSizeClass(width) === 'wide'
}

export function usesAssistantSideRail(transcriptWidth: number): boolean {
  return transcriptWidth >= CHAT_CONTENT_MAX
}

export function responsiveHorizontalPadding(width: number): number {
  if (width <= COMPACT_WINDOW_MAX) return 18
  if (width < PERSISTENT_SIDEBAR_MIN) return 24
  return 28
}

/** Live column width for transcript rows. Avoids locking FlatList content to a measured size. */
export function transcriptColumnWidth(paneWidth: number, padding = responsiveHorizontalPadding(paneWidth)): number {
  return Math.max(0, Math.min(CHAT_CONTENT_MAX, paneWidth - padding * 2))
}
