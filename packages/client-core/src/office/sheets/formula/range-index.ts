/**
 * Which rectangles contain a cell (or overlap a rectangle)? The dependency graph stores every
 * multi-cell reference here once per distinct rectangle, so `=SUM(A:A)` costs one entry rather
 * than a million per-cell edges, and a thousand formulas reading `A:A` share that entry.
 *
 * Rectangles are bucketed by 64-column blocks (very wide ones share a single bucket); each bucket
 * keeps its entries sorted by top row with a max-bottom segment tree, so a stabbing query is
 * O(log n + hits). Edits go to a small unsorted overflow list until a rebuild pays off.
 */

export interface Rect {
  top: number
  left: number
  bottom: number
  right: number
}

interface Entry<T> extends Rect {
  key: string
  items: Set<T>
  /** Last query token that visited this entry. */
  mark: number
}

const BLOCK_SHIFT = 6
const MAX_BLOCKS = 4

/** Query tokens are global so a token from one index never collides with marks left by another pass. */
let lastToken = 0

/** A fresh token for `RangeIndex.query`: entries visited under the same token are reported only once. */
export function newQueryToken(): number {
  return ++lastToken
}

class Bucket<T> {
  readonly live = new Set<Entry<T>>()
  private sorted: Entry<T>[] = []
  private tops: number[] = []
  private tree = new Float64Array(0)
  private size = 0
  private overflow: Entry<T>[] = []
  private removed = 0

  add(entry: Entry<T>): void {
    this.live.add(entry)
    this.overflow.push(entry)
  }

  remove(entry: Entry<T>): void {
    if (this.live.delete(entry)) this.removed++
  }

  query(top: number, bottom: number, visit: (entry: Entry<T>) => void): void {
    if (this.overflow.length > 32 + (this.sorted.length >> 2) || this.removed > 32 + (this.sorted.length >> 1)) this.rebuild()
    for (const entry of this.overflow) {
      if (entry.top <= bottom && entry.bottom >= top && this.live.has(entry)) visit(entry)
    }
    if (!this.sorted.length) return
    // Entries with top <= bottom form a prefix of the sorted array.
    let lo = 0
    let hi = this.tops.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.tops[mid]! <= bottom) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) this.walk(1, 0, this.size, lo, top, visit)
  }

  private walk(node: number, from: number, to: number, limit: number, top: number, visit: (entry: Entry<T>) => void): void {
    if (from >= limit || this.tree[node]! < top) return
    if (to - from === 1) {
      const entry = this.sorted[from]
      if (entry && this.live.has(entry)) visit(entry)
      return
    }
    const mid = (from + to) >> 1
    this.walk(node * 2, from, mid, limit, top, visit)
    this.walk(node * 2 + 1, mid, to, limit, top, visit)
  }

  private rebuild(): void {
    this.sorted = [...this.live].sort((a, b) => a.top - b.top)
    this.tops = this.sorted.map((entry) => entry.top)
    this.overflow = []
    this.removed = 0
    let size = 1
    while (size < this.sorted.length) size *= 2
    this.size = size
    this.tree = new Float64Array(size * 2).fill(-1)
    for (let i = 0; i < this.sorted.length; i++) this.tree[size + i] = this.sorted[i]!.bottom
    for (let i = size - 1; i >= 1; i--) this.tree[i] = Math.max(this.tree[i * 2]!, this.tree[i * 2 + 1]!)
  }
}

export class RangeIndex<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly blocks = new Map<number, Bucket<T>>()
  private readonly wide = new Bucket<T>()

  /** Number of distinct rectangles stored. */
  get size(): number {
    return this.entries.size
  }

  add(rect: Rect, item: T): void {
    const key = `${rect.top},${rect.left},${rect.bottom},${rect.right}`
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, key, items: new Set(), mark: 0 }
      this.entries.set(key, entry)
      for (const bucket of this.bucketsFor(entry, true)) bucket.add(entry)
    }
    entry.items.add(item)
  }

  remove(rect: Rect, item: T): void {
    const key = `${rect.top},${rect.left},${rect.bottom},${rect.right}`
    const entry = this.entries.get(key)
    if (!entry || !entry.items.delete(item) || entry.items.size) return
    this.entries.delete(key)
    for (const bucket of this.bucketsFor(entry, false)) bucket.remove(entry)
  }

  /**
   * Calls `visit` for every item whose rectangle overlaps `rect`. Pass the same `token` across
   * several queries to skip entries an earlier query already reported.
   */
  query(rect: Rect, visit: (item: T) => void, token = newQueryToken()): void {
    const onEntry = (entry: Entry<T>) => {
      if (entry.mark === token || entry.left > rect.right || entry.right < rect.left) return
      entry.mark = token
      for (const item of entry.items) visit(item)
    }
    const first = rect.left >> BLOCK_SHIFT
    const last = rect.right >> BLOCK_SHIFT
    if (last - first + 1 <= this.blocks.size) {
      for (let block = first; block <= last; block++) this.blocks.get(block)?.query(rect.top, rect.bottom, onEntry)
    } else {
      for (const [block, bucket] of this.blocks) if (block >= first && block <= last) bucket.query(rect.top, rect.bottom, onEntry)
    }
    this.wide.query(rect.top, rect.bottom, onEntry)
  }

  private bucketsFor(rect: Rect, create: boolean): Bucket<T>[] {
    const first = rect.left >> BLOCK_SHIFT
    const last = rect.right >> BLOCK_SHIFT
    if (last - first + 1 > MAX_BLOCKS) return [this.wide]
    const buckets: Bucket<T>[] = []
    for (let block = first; block <= last; block++) {
      let bucket = this.blocks.get(block)
      if (!bucket && create) {
        bucket = new Bucket()
        this.blocks.set(block, bucket)
      }
      if (bucket) buckets.push(bucket)
    }
    return buckets
  }
}
