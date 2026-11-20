/**
 * Where the workspace's screen sits in the viewer and how a touch maps back to it. The picture is
 * fitted into the viewport and centred, then moved by `x`/`y` and zoomed by `scale` about the
 * viewport's centre (React Native transforms a view about its own centre, and the picture is
 * centred in the viewport). These run as worklets during gestures, and in tests as plain functions.
 */

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface ViewTransform { scale: number; x: number; y: number }

export const MIN_ZOOM = 1
export const MAX_ZOOM = 5
/** A double tap while watching zooms to this, or back out. */
export const DOUBLE_TAP_ZOOM = 2.5
/** How far a finger drags on the workspace's screen, in its pixels, for one wheel notch. */
export const SCROLL_NOTCH_PIXELS = 48

export function clampValue(value: number, minimum: number, maximum: number): number {
  'worklet'
  // `|| 0` turns -0 (from a zero range) and NaN into a plain 0.
  return Math.min(maximum, Math.max(minimum, value)) || 0
}

/** The picture's size at zoom 1: as large as fits, keeping the screen's shape. */
export function fittedSize(viewport: Size, screen: Size): Size {
  'worklet'
  const ratio = Math.min(viewport.width / Math.max(1, screen.width), viewport.height / Math.max(1, screen.height))
  const factor = Number.isFinite(ratio) && ratio > 0 ? ratio : 0
  return { width: screen.width * factor, height: screen.height * factor }
}

/** Keeps the zoomed picture covering the viewport where it can, and centred where it is smaller. */
export function clampTransform(transform: ViewTransform, viewport: Size, fitted: Size): ViewTransform {
  'worklet'
  const scale = clampValue(transform.scale, MIN_ZOOM, MAX_ZOOM)
  const maxX = Math.max(0, (fitted.width * scale - viewport.width) / 2)
  const maxY = Math.max(0, (fitted.height * scale - viewport.height) / 2)
  return { scale, x: clampValue(transform.x, -maxX, maxX), y: clampValue(transform.y, -maxY, maxY) }
}

/**
 * The transform for a two-finger gesture that started at `start` with its fingers' middle at
 * `focalStart`: the point of the picture under that spot follows the fingers' middle (`focal`)
 * while the picture is zoomed by `pinch`.
 */
export function pinchTransform(
  start: ViewTransform,
  focalStart: Point,
  focal: Point,
  pinch: number,
  viewport: Size,
  fitted: Size,
): ViewTransform {
  'worklet'
  const scale = clampValue(start.scale * pinch, MIN_ZOOM, MAX_ZOOM)
  const ratio = scale / start.scale
  const centreX = viewport.width / 2
  const centreY = viewport.height / 2
  return clampTransform({
    scale,
    x: focal.x - centreX - ratio * (focalStart.x - centreX - start.x),
    y: focal.y - centreY - ratio * (focalStart.y - centreY - start.y),
  }, viewport, fitted)
}

/**
 * The point on the workspace's screen under a touch at `point` in the viewport, in the screen's
 * pixels, or null when the touch is beside the picture.
 */
export function screenPoint(point: Point, transform: ViewTransform, viewport: Size, screen: Size): Point | null {
  'worklet'
  const fitted = fittedSize(viewport, screen)
  if (fitted.width <= 0 || fitted.height <= 0 || transform.scale <= 0) return null
  const localX = fitted.width / 2 + (point.x - viewport.width / 2 - transform.x) / transform.scale
  const localY = fitted.height / 2 + (point.y - viewport.height / 2 - transform.y) / transform.scale
  if (localX < 0 || localY < 0 || localX > fitted.width || localY > fitted.height) return null
  const factor = screen.width / fitted.width
  return {
    x: Math.round(clampValue(localX * factor, 0, screen.width)),
    y: Math.round(clampValue(localY * factor, 0, screen.height)),
  }
}

/**
 * Whole wheel notches for a drag of `distance` viewport points, on top of what earlier updates of
 * the same drag already sent. The finger moves the page as on a phone, so dragging up scrolls down.
 */
export function scrollNotches(distance: number, sent: number, transform: ViewTransform, viewport: Size, screen: Size): number {
  'worklet'
  const fitted = fittedSize(viewport, screen)
  if (fitted.width <= 0 || transform.scale <= 0) return 0
  const pixels = -distance * (screen.width / fitted.width) / transform.scale
  return Math.trunc(pixels / SCROLL_NOTCH_PIXELS) - sent
}
