import type { CellRange } from './address.js'
import { RangeIndex } from './formula/range-index.js'

/** Ordered rectangle lookup for a rendering or editing pass. */
export class RangeLookup<T> {
  private readonly index = new RangeIndex<{ value: T; order: number }>()
  constructor(values: readonly T[], ranges: (value: T) => readonly CellRange[]) {
    values.forEach((value, order) => {
      const item = { value, order }
      for (const range of ranges(value)) this.index.add(range, item)
    })
  }

  first(row: number, col: number): T | undefined {
    let result: { value: T; order: number } | undefined
    this.index.query({ top: row, bottom: row, left: col, right: col }, (item) => {
      if (!result || item.order < result.order) result = item
    })
    return result?.value
  }

  overlapping(range: CellRange): T[] {
    const items = new Set<{ value: T; order: number }>()
    this.index.query(range, (item) => { items.add(item) })
    return [...items].sort((a, b) => a.order - b.order).map((item) => item.value)
  }
}
