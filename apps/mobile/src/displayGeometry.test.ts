import { describe, expect, it } from 'vitest'
import {
  EMPTY_DISPLAY_GEOMETRY,
  persistentSidebarWidth,
  resolveVerticalBar,
  resolveVerticalFold,
  type DisplayGeometry,
} from './displayGeometry'
import { SIDEBAR_WIDTH } from './responsive'

// Values iOS 27.1 reports on the iPhone Duo simulator.
const COVER: DisplayGeometry = {
  verticalBarEdge: 'trailing',
  occlusions: [
    { x: 399.67, y: 29.33, width: 37, height: 37 },
    { x: 382, y: 0, width: 84, height: 174 },
  ],
  divisions: [],
}
const COVER_INSETS = { top: 0, left: 0, right: 84 }
const INNER: DisplayGeometry = {
  verticalBarEdge: 'trailing',
  occlusions: [{ x: 867, y: 0, width: 84, height: 124 }],
  divisions: [],
}
const HALF_OPEN: DisplayGeometry = {
  ...INNER,
  divisions: [{ x: 455.5, y: 0, width: 40, height: 669, margins: { top: 0, left: 20, bottom: 0, right: 20 } }],
}

describe('vertical bar', () => {
  it('is absent on devices without one', () => {
    expect(resolveVerticalBar(EMPTY_DISPLAY_GEOMETRY, { top: 62, left: 0, right: 0 }, 402)).toBeNull()
  })

  it('reserves the trailing column and starts items below the status bar on the cover display', () => {
    expect(resolveVerticalBar(COVER, COVER_INSETS, 466)).toEqual({ side: 'right', width: 84, itemsTop: 174, itemEdgeInset: 24 })
  })

  it('starts items below the shorter status bar on the inner display', () => {
    expect(resolveVerticalBar(INNER, COVER_INSETS, 951)?.itemsTop).toBe(124)
  })

  it('ignores occlusions outside the column', () => {
    const geometry = { ...INNER, occlusions: [...INNER.occlusions, { x: 677, y: 21, width: 58, height: 300 }] }
    expect(resolveVerticalBar(geometry, COVER_INSETS, 951)?.itemsTop).toBe(124)
  })

  it('follows the layout direction for a trailing bar', () => {
    expect(resolveVerticalBar(INNER, { top: 0, left: 84, right: 0 }, 951, true)).toMatchObject({ side: 'left', width: 84 })
  })

  it('needs a safe area inset to reserve a column', () => {
    expect(resolveVerticalBar(INNER, { top: 0, left: 0, right: 0 }, 951)).toBeNull()
  })
})

describe('vertical fold', () => {
  it('finds the hinge when half open', () => {
    expect(resolveVerticalFold(HALF_OPEN, 951, 669)).toEqual({ center: 475.5, start: 455.5, end: 495.5 })
  })

  it('has no fold when fully open or closed', () => {
    expect(resolveVerticalFold(INNER, 951, 669)).toBeNull()
    expect(resolveVerticalFold(COVER, 466, 678)).toBeNull()
  })

  it('ignores divisions that do not split the window into pages', () => {
    const across = { ...INNER, divisions: [{ x: 0, y: 320, width: 951, height: 40, margins: { top: 20, left: 0, bottom: 20, right: 0 } }] }
    expect(resolveVerticalFold(across, 951, 669)).toBeNull()
  })

  it('gives the persistent sidebar the page before the fold', () => {
    expect(persistentSidebarWidth(resolveVerticalFold(HALF_OPEN, 951, 669), 951)).toBe(475.5)
  })

  it('keeps the usual sidebar width without a fold or when a page would be too narrow', () => {
    expect(persistentSidebarWidth(null, 951)).toBe(SIDEBAR_WIDTH)
    expect(persistentSidebarWidth({ center: 250, start: 230, end: 270 }, 951)).toBe(SIDEBAR_WIDTH)
    expect(persistentSidebarWidth({ center: 600, start: 580, end: 620 }, 900)).toBe(SIDEBAR_WIDTH)
  })
})
