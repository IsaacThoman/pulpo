import { describe, expect, it } from 'vitest'
import { arrangeGrid, GRID_CELL, moveInGrid, nearestFreeCell, readingOrder } from './grid-layout'

const W = GRID_CELL.width, H = GRID_CELL.height

describe('grid layout', () => {
  it('fills free cells row by row around saved places', () => {
    const placed = arrangeGrid(['a', 'b', 'c'], { b: { x: 0, y: 0 } }, { columns: 2, snap: true })
    expect(placed.get('b')).toEqual({ x: 0, y: 0 })
    expect(placed.get('a')).toEqual({ x: W, y: 0 })
    expect(placed.get('c')).toEqual({ x: 0, y: H })
  })

  it('snaps saved places to free cells, or keeps them exactly when not snapping', () => {
    const saved = { a: { x: 10, y: 5 }, b: { x: 20, y: 12 } }
    const snapped = arrangeGrid(['a', 'b'], saved, { columns: 4, snap: true })
    expect(snapped.get('a')).toEqual({ x: 0, y: 0 })
    expect(snapped.get('b')).not.toEqual({ x: 0, y: 0 })
    expect(arrangeGrid(['a', 'b'], saved, { columns: 4, snap: false }).get('b')).toEqual({ x: 20, y: 12 })
  })

  it('moves a selection by the drag offset, landing in the nearest free cells', () => {
    const start = arrangeGrid(['a', 'b', 'c'], {}, { columns: 3, snap: true })
    const moved = moveInGrid(start, ['a', 'b'], { x: W * 2 + 10, y: H * 3 - 8 }, true)
    expect(moved.get('a')).toEqual({ x: W * 2, y: H * 3 })
    expect(moved.get('b')).toEqual({ x: W * 3, y: H * 3 })
    expect(moved.get('c')).toEqual(start.get('c'))
    const free = moveInGrid(start, ['a'], { x: -500, y: 37 }, false)
    expect(free.get('a')).toEqual({ x: 0, y: 37 })
  })

  it('finds the nearest free cell and reads top to bottom, left to right', () => {
    expect(nearestFreeCell({ col: 0, row: 0 }, new Set(['0:0']))).toEqual({ col: 1, row: 0 })
    expect(readingOrder(new Map([['low', { x: 0, y: H }], ['right', { x: W, y: 0 }], ['left', { x: 0, y: 0 }]]))).toEqual(['left', 'right', 'low'])
  })
})
