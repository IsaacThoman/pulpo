/**
 * Positions of rows and columns in CSS pixels at 100% zoom. Most rows and columns have the
 * default size, so only the exceptions are stored (sorted), with running totals of how much
 * they differ from the default; offsets and hit tests are binary searches.
 */
export class AxisLayout {
  /** Indexes with a non-default size, ascending. */
  private readonly indexes: number[]
  private readonly sizes: number[]
  /** `deltas[i]`: total (size - default) of the first i exceptions. */
  private readonly deltas: number[]

  constructor(
    readonly defaultSize: number,
    exceptions: Map<number, number>,
    /** Number of rows or columns the grid shows. */
    readonly count: number,
  ) {
    this.indexes = [...exceptions.keys()].filter((index) => index < count).sort((a, b) => a - b)
    this.sizes = this.indexes.map((index) => exceptions.get(index)!)
    this.deltas = [0]
    for (let index = 0; index < this.indexes.length; index++) this.deltas.push(this.deltas[index]! + this.sizes[index]! - defaultSize)
  }

  /** Number of exceptions before `index` (binary search). */
  private rank(index: number): number {
    let low = 0
    let high = this.indexes.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.indexes[middle]! < index) low = middle + 1
      else high = middle
    }
    return low
  }

  size(index: number): number {
    const position = this.rank(index)
    return this.indexes[position] === index ? this.sizes[position]! : this.defaultSize
  }

  /** Distance from the start of the grid to the start of `index`. */
  offset(index: number): number {
    return index * this.defaultSize + this.deltas[this.rank(index)]!
  }

  get total(): number {
    return this.offset(this.count)
  }

  /** The index whose span contains `offset` (clamped to the grid). Hidden (zero-size) ones are skipped. */
  indexAt(offset: number): number {
    if (offset <= 0) return this.firstVisibleFrom(0)
    let low = 0
    let high = this.count - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (this.offset(middle) <= offset) low = middle
      else high = middle - 1
    }
    return this.firstVisibleFrom(low)
  }

  private firstVisibleFrom(index: number): number {
    let current = index
    while (current < this.count - 1 && this.size(current) === 0) current++
    return current
  }

  isHidden(index: number): boolean {
    return this.size(index) === 0
  }

  /** The next visible index after `index` in a direction, or `index` itself at the edge. */
  step(index: number, direction: 1 | -1): number {
    let current = index + direction
    while (current >= 0 && current < this.count && this.size(current) === 0) current += direction
    return current < 0 || current >= this.count ? index : current
  }
}

/** Excel's maximum digit width of a font in pixels, from a measured width of '0'. */
export function maxDigitWidth(measured: number): number {
  return Math.max(1, Math.round(measured))
}

/**
 * Pixels of a stored column `width` (Excel character units, which include the cell padding):
 * ECMA-376's conversion, so 9.140625 at 7px digits (Excel's default 8.43) is 64 pixels.
 */
export function columnWidthToPixels(width: number, digitWidth: number): number {
  if (width <= 0) return 0
  return Math.trunc(((256 * width + Math.trunc(128 / digitWidth)) / 256) * digitWidth)
}

/** The stored width for a column `pixels` wide (the inverse of columnWidthToPixels). */
export function pixelsToColumnWidth(pixels: number, digitWidth: number): number {
  return Math.trunc((pixels / digitWidth) * 256) / 256
}

/**
 * Pixels of the default column for `baseColWidth` characters: Excel's 8-character default is
 * 64 pixels with Calibri 11 (digits plus padding and gridline).
 */
export function defaultColumnPixels(baseColWidth: number, digitWidth: number): number {
  return baseColWidth * digitWidth + 8
}

export const POINTS_TO_PIXELS = 96 / 72
