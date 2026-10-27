import { SIDEBAR_WIDTH } from './responsive'

export type DisplayRect = { x: number; y: number; width: number; height: number }
export type DisplayDivision = DisplayRect & {
  /** Space on each side of the fold, inside `width`, to keep interactive content out of. */
  margins: { top: number; left: number; bottom: number; right: number }
}

/**
 * Display geometry reported by iOS 27.1 for iPhone Duo, in window points.
 * Other devices report no vertical bar and no regions.
 */
export type DisplayGeometry = {
  verticalBarEdge: 'leading' | 'trailing' | 'none'
  /** Active regions covered by sensors and the vertical status bar. */
  occlusions: DisplayRect[]
  /** Active folds content should divide around, such as the half-open hinge. */
  divisions: DisplayDivision[]
}

export const EMPTY_DISPLAY_GEOMETRY: DisplayGeometry = { verticalBarEdge: 'none', occlusions: [], divisions: [] }

/** A fold only splits the window when the page after it can still hold a chat. */
export const FOLD_PAGE_MIN_WIDTH = 360

/**
 * The column iOS reserves on one side of the window for the status bar and
 * bar items. Below the sensors and status bar at its top, it is empty.
 */
export type VerticalBar = {
  side: 'left' | 'right'
  width: number
  /** Where the sensors and status bar at the top of the column end. */
  statusBottom: number
}

export function resolveVerticalBar(
  geometry: DisplayGeometry,
  insets: { top: number; left: number; right: number },
  windowWidth: number,
  rtl = false,
): VerticalBar | null {
  if (geometry.verticalBarEdge === 'none') return null
  const side = (geometry.verticalBarEdge === 'trailing') !== rtl ? 'right' : 'left'
  const width = side === 'right' ? insets.right : insets.left
  if (width <= 0) return null
  const columnStart = side === 'right' ? windowWidth - width : 0
  const columnEnd = columnStart + width
  const statusBottom = geometry.occlusions
    .filter((region) => region.x < columnEnd && region.x + region.width > columnStart)
    .reduce((bottom, region) => Math.max(bottom, region.y + region.height), insets.top)
  return { side, width, statusBottom }
}

/** An active fold running the height of the window, splitting it into left and right pages. */
export type VerticalFold = {
  /** Where the hinge is. */
  center: number
  /** Leading edge of the fold region, margins included. */
  start: number
  /** Trailing edge of the fold region, margins included. */
  end: number
}

export function resolveVerticalFold(geometry: DisplayGeometry, windowWidth: number, windowHeight: number): VerticalFold | null {
  const division = geometry.divisions.find((region) => region.height >= windowHeight * 0.9 && region.width < windowWidth / 2)
  if (!division) return null
  const crease = division.width - division.margins.left - division.margins.right
  return {
    center: division.x + division.margins.left + Math.max(0, crease) / 2,
    start: division.x,
    end: division.x + division.width,
  }
}

/**
 * Half open, the persistent sidebar takes the whole page before the fold and
 * the chat takes the page after it. Otherwise it keeps its usual width.
 */
export function persistentSidebarWidth(fold: VerticalFold | null, windowWidth: number): number {
  if (!fold) return SIDEBAR_WIDTH
  const fitsBothPages = fold.center >= SIDEBAR_WIDTH && windowWidth - fold.center >= FOLD_PAGE_MIN_WIDTH
  return fitsBothPages ? fold.center : SIDEBAR_WIDTH
}
