import { describe, expect, it } from 'vitest'
import { clampTransform, fittedSize, MAX_ZOOM, pinchTransform, screenPoint, scrollNotches, SCROLL_NOTCH_PIXELS } from './geometry'

const screen = { width: 1280, height: 800 }
// A phone in portrait: the screen fits the width, 400 points wide and 250 tall.
const viewport = { width: 400, height: 600 }
const fitted = fittedSize(viewport, screen)
const identity = { scale: 1, x: 0, y: 0 }

describe('fittedSize', () => {
  it('fits the width in portrait and the height in landscape', () => {
    expect(fitted).toEqual({ width: 400, height: 250 })
    expect(fittedSize({ width: 900, height: 400 }, screen)).toEqual({ width: 640, height: 400 })
  })

  it('is empty before the viewport is laid out', () => {
    expect(fittedSize({ width: 0, height: 0 }, screen)).toEqual({ width: 0, height: 0 })
  })
})

describe('screenPoint', () => {
  it('maps a touch on the fitted picture to the screen', () => {
    // The picture is centred: its top is at (600 - 250) / 2.
    expect(screenPoint({ x: 0, y: 175 }, identity, viewport, screen)).toEqual({ x: 0, y: 0 })
    expect(screenPoint({ x: 200, y: 300 }, identity, viewport, screen)).toEqual({ x: 640, y: 400 })
    expect(screenPoint({ x: 400, y: 425 }, identity, viewport, screen)).toEqual({ x: 1280, y: 800 })
  })

  it('ignores a touch beside the picture', () => {
    expect(screenPoint({ x: 200, y: 100 }, identity, viewport, screen)).toBeNull()
    expect(screenPoint({ x: 200, y: 500 }, identity, viewport, screen)).toBeNull()
  })

  it('follows the zoom and the pan', () => {
    // Zoomed 2× about the middle: the middle of the viewport is still the middle of the screen.
    expect(screenPoint({ x: 200, y: 300 }, { scale: 2, x: 0, y: 0 }, viewport, screen)).toEqual({ x: 640, y: 400 })
    // The left edge of the viewport now shows a quarter of the way across.
    expect(screenPoint({ x: 0, y: 300 }, { scale: 2, x: 0, y: 0 }, viewport, screen)).toEqual({ x: 320, y: 400 })
    // Moved right by 200 points, the left edge shows the screen's left edge.
    expect(screenPoint({ x: 0, y: 300 }, { scale: 2, x: 200, y: 0 }, viewport, screen)).toEqual({ x: 0, y: 400 })
  })

  it('maps through any transform the inverse of how the picture is drawn', () => {
    const transform = { scale: 3, x: -150, y: 40 }
    const target = { x: 900, y: 120 }
    const factor = fitted.width / screen.width
    // Where React Native draws that screen point: about the viewport's centre, after moving.
    const drawn = {
      x: viewport.width / 2 + transform.x + transform.scale * (target.x * factor - fitted.width / 2),
      y: viewport.height / 2 + transform.y + transform.scale * (target.y * factor - fitted.height / 2),
    }
    expect(screenPoint(drawn, transform, viewport, screen)).toEqual(target)
  })
})

describe('clampTransform', () => {
  it('keeps the picture from leaving the viewport', () => {
    expect(clampTransform({ scale: 1, x: 80, y: -40 }, viewport, fitted)).toEqual({ scale: 1, x: 0, y: 0 })
    // At 4× the picture is 1600 by 1000: it can move 600 sideways and 200 up or down.
    expect(clampTransform({ scale: 4, x: 900, y: -900 }, viewport, fitted)).toEqual({ scale: 4, x: 600, y: -200 })
  })

  it('limits the zoom', () => {
    expect(clampTransform({ scale: 0.4, x: 0, y: 0 }, viewport, fitted).scale).toBe(1)
    expect(clampTransform({ scale: 40, x: 0, y: 0 }, viewport, fitted).scale).toBe(MAX_ZOOM)
  })
})

describe('pinchTransform', () => {
  it('keeps the point between the fingers under them while zooming', () => {
    // On the vertical middle: at 2× the picture is still shorter than the viewport, so it stays centred.
    const focal = { x: 300, y: 300 }
    const before = screenPoint(focal, identity, viewport, screen)
    const after = pinchTransform(identity, focal, focal, 2, viewport, fitted)
    expect(after.scale).toBe(2)
    expect(screenPoint(focal, after, viewport, screen)).toEqual(before)
  })

  it('moves the picture with the fingers', () => {
    const start = { scale: 3, x: 0, y: 0 }
    expect(pinchTransform(start, { x: 200, y: 300 }, { x: 150, y: 330 }, 1, viewport, fitted)).toEqual({ scale: 3, x: -50, y: 30 })
  })
})

describe('scrollNotches', () => {
  // At zoom 1 one viewport point is 3.2 screen pixels.
  const notch = SCROLL_NOTCH_PIXELS / 3.2

  it('scrolls down when the finger drags up, one notch per step', () => {
    expect(scrollNotches(-notch * 0.5, 0, identity, viewport, screen)).toBe(0)
    expect(scrollNotches(-notch * 2.5, 0, identity, viewport, screen)).toBe(2)
    expect(scrollNotches(notch * 3, 0, identity, viewport, screen)).toBe(-3)
  })

  it('counts only what earlier updates of the drag did not send', () => {
    expect(scrollNotches(-notch * 3.1, 2, identity, viewport, screen)).toBe(1)
    expect(scrollNotches(-notch * 1.5, 2, identity, viewport, screen)).toBe(-1)
  })

  it('needs a longer drag when zoomed in', () => {
    expect(scrollNotches(-notch * 1.5, 0, { scale: 2, x: 0, y: 0 }, viewport, screen)).toBe(0)
    expect(scrollNotches(-notch * 2, 0, { scale: 2, x: 0, y: 0 }, viewport, screen)).toBe(1)
  })
})
