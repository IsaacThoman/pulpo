import { describe, expect, it } from 'vitest'
import { MAX_COLS, MAX_ROWS, parseRangeName, type CellRange } from './address.js'
import { contains, intersects, normalizeRanges, subtractRanges, unionRanges } from './range-set.js'
const rect = (text: string) => parseRangeName(text)!
const cells = (ranges: readonly CellRange[]) => new Set(ranges.flatMap((r) => Array.from({ length: r.bottom - r.top + 1 }, (_, dr) => Array.from({ length: r.right - r.left + 1 }, (_, dc) => `${r.top + dr}:${r.left + dc}`)).flat()))

describe('sqref range algebra', () => {
  it.each([
    ['A1:A10', ['A5'], ['A1:A4', 'A6:A10']],
    ['A1:D4', ['B2:C3'], ['A1:D1', 'A2:A3', 'D2:D3', 'A4:D4']],
    ['A1:D4', ['A1:D2', 'B2:C4'], ['A3:A4', 'D3:D4']],
    ['A1:D4', ['A1:D4'], []],
    ['B2:C3', ['A1:D4'], []],
    ['B2:C3', ['D1:D4'], ['B2:C3']],
  ])('subtracts %s minus %s', (source, cuts, expected) => {
    expect(subtractRanges([rect(source)], cuts.map(rect))).toEqual(expected.map(rect))
  })
  it('unions overlaps, duplicates and adjacent rectangles, independent of ordering', () => {
    const input = ['A1:B2', 'B1:C2', 'A3:C3', 'A1:A1'].map(rect)
    const saved = JSON.stringify(input)
    expect(normalizeRanges(input)).toEqual([rect('A1:C3')])
    expect(unionRanges(input.slice(0, 2), input.slice(2))).toEqual([rect('A1:C3')])
    expect(normalizeRanges(input.reverse())).toEqual([rect('A1:C3')])
    expect(JSON.stringify(input.reverse())).toBe(saved)
  })
  it('operates on the full Excel grid without allocating cells', () => {
    const grid = { top: 0, left: 0, bottom: MAX_ROWS - 1, right: MAX_COLS - 1 }
    expect(subtractRanges([grid], [rect('B:B')])).toEqual([rect('A:A'), { ...grid, left: 2 }])
    expect(unionRanges(subtractRanges([grid], [rect('B:B')]), [rect('B:B')])).toEqual([grid])
  })
  it('matches a seeded brute-force cell-set model for multi-rectangle operations', () => {
    let seed = 0x947
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n }
    const set = () => Array.from({ length: random(9) }, () => {
      const r = [random(9), random(9)].sort((a, b) => a - b), c = [random(9), random(9)].sort((a, b) => a - b)
      return { top: r[0]!, bottom: r[1]!, left: c[0]!, right: c[1]! }
    })
    for (let i = 0; i < 600; i++) {
      const a = set(), b = set(), ac = cells(a), bc = cells(b)
      const difference = subtractRanges(a, b), union = unionRanges(a, b), normalized = normalizeRanges(a)
      expect(cells(difference)).toEqual(new Set([...ac].filter((c) => !bc.has(c))))
      expect(cells(union)).toEqual(new Set([...ac, ...bc]))
      expect(cells(normalized)).toEqual(ac)
      for (const result of [difference, union, normalized]) {
        expect(normalizeRanges(result)).toEqual(result)
        expect(normalizeRanges([...result].reverse())).toEqual(result)
        for (let j = 0; j < result.length; j++) for (const r of result.slice(j + 1)) {
          expect(intersects(result[j]!, r)).toBe(false)
          const pair = normalizeRanges([result[j]!, r])
          expect(pair.length).toBe(2)
          expect(contains(result[j]!, r)).toBe(false)
        }
      }
    }
  })
})
