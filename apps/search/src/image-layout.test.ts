import { describe, expect, it } from 'vitest'
import { galleryGap, sizeImageTiles } from './image-layout'

describe('image gallery rows', () => {
  it('fills desktop rows with equal heights and preserves different aspects', () => {
    const tiles = sizeImageTiles([.7, 1.9, 1.3, 1.5, .8, 2, 1.5, 1.5, 1.3, .8], 1220)
    const end = tiles.findIndex((tile, index) => index > 0 && tile.rowStart)
    const row = tiles.slice(0, end)
    expect(row.length).toBeGreaterThan(2)
    expect(row.reduce((total, tile) => total + tile.width, 0) + (row.length - 1) * galleryGap).toBe(1220)
    expect(row.every(tile => tile.height === row[0].height)).toBe(true)
    expect(row[0].width).toBeLessThan(row[1].width)
  })

  it('keeps phone rows paired and leaves an incomplete row at a useful size', () => {
    const tiles = sizeImageTiles([2, .65, 1.5, 1.5, .9], 350)
    expect(tiles.map(tile => tile.rowStart)).toEqual([true, false, true, false, true])
    expect(tiles[0].width + tiles[1].width + galleryGap).toBe(350)
    expect(tiles[2].width + tiles[3].width + galleryGap).toBe(350)
    expect(tiles[4].width).toBeLessThan(350)
  })

  it('has a stable fallback for missing or invalid dimensions', () => {
    const tiles = sizeImageTiles([undefined, NaN, 0], 320)
    expect(tiles[0].width).toBe(tiles[1].width)
    expect(tiles.every(tile => tile.width > 0 && tile.height > 0)).toBe(true)
  })
})
