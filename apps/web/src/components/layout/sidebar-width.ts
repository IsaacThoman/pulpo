import { MAIN_VIEW_MIN_WIDTH } from '@/features/side-panel/store'

/** The desktop sidebar's folded rail; the open sidebar is as wide as the user drags it. */
export const SIDEBAR_COLLAPSED_WIDTH = 52
export const DEFAULT_SIDEBAR_WIDTH = 264
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 385
/** Dragging the edge in past this folds the sidebar to its rail; dragging the rail out past it opens it. */
export const SIDEBAR_SNAP_WIDTH = (SIDEBAR_COLLAPSED_WIDTH + SIDEBAR_MIN_WIDTH) / 2
const WIDTH_STORAGE_KEY = 'pulpo.sidebar.width'

/** The widest the open sidebar may be in this frame: it always leaves the main view its minimum. */
export function sidebarMaxWidth(frameWidth: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, frameWidth - MAIN_VIEW_MIN_WIDTH))
}

export function clampSidebarWidth(width: number, frameWidth: number): number {
  return Math.round(Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), sidebarMaxWidth(frameWidth)))
}

export function readSidebarWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
    if (Number.isFinite(saved) && saved > 0) return saved
  } catch { /* the preference is optional */ }
  return DEFAULT_SIDEBAR_WIDTH
}

export function writeSidebarWidth(width: number): void {
  try { localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(width))) } catch { /* the preference is optional */ }
}

/**
 * Sizes the open sidebar, and the title bar pieces aligned with it, through `--sidebar-width`, so
 * a drag restyles them without rerendering the chat list.
 */
export function applySidebarWidth(width: number): void {
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`)
}
