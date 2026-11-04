import * as Y from 'yjs'

/**
 * Stable identity for rows and columns, so that structural edits and content edits made at the
 * same time on different replicas keep their intent: a cell is stored under its row and column
 * ids, never under its index, so a row inserted above it by someone else moves it down instead of
 * overwriting it, and formulas refer to ids so they never need rewriting when rows move.
 *
 * An axis is a Y.Array of ids in display order. Rows nobody has touched are not stored: the axis
 * continues virtually past its end with "virtual ids", the decimal numbers after the highest
 * virtual id ever used. Materializing the axis appends exactly those ids, so a reference to a row
 * past the end (a formula pointing at A5000 in a 100-row sheet) can name it before it exists, and
 * still finds it after someone else materializes it. Two replicas materializing the same rows at
 * once both append the same ids; the first occurrence wins and later duplicates are ignored.
 *
 * Inserted rows get random ids (never all digits). Deleted ids are tombstoned with the index they
 * had, both so they never come back (a concurrent materialization can re-append a deleted virtual
 * id) and so references to them can be resolved approximately (a range whose last row was deleted
 * concurrently shrinks instead of breaking).
 */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A fresh random id: a letter then seven base-36 characters (2.0e12 possibilities). */
export function randomId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let id = ID_ALPHABET[bytes[0]! % 26]!
  for (let index = 1; index < 8; index++) id += ID_ALPHABET[bytes[index]! % 36]!
  return id
}

function virtualNumber(id: string): number {
  // Only canonical decimal numbers are virtual ids ("007" is not).
  return /^(0|[1-9]\d{0,9})$/.test(id) ? Number(id) : -1
}

export interface AxisSnapshot {
  /** Ids in display order, without duplicates or tombstoned ids. */
  readonly ids: readonly string[]
  /** Next virtual id: the axis continues with `next`, `next + 1`, … past `ids`. */
  readonly next: number
  /** Index of each live id. */
  readonly index: ReadonlyMap<string, number>
}

export class Axis {
  private snapshot: AxisSnapshot | undefined

  constructor(
    readonly order: Y.Array<string>,
    /** Tombstones: deleted id → the index it had when it was deleted. */
    readonly dead: Y.Map<number>,
  ) {
    order.observe(() => this.invalidate())
    dead.observe(() => this.invalidate())
  }

  /** The current resolved order. Cached until the axis changes. */
  resolve(): AxisSnapshot {
    if (this.snapshot) return this.snapshot
    const ids: string[] = []
    const index = new Map<string, number>()
    let next = 0
    for (const [id] of this.dead) next = Math.max(next, virtualNumber(id) + 1)
    for (const id of this.order) {
      next = Math.max(next, virtualNumber(id) + 1)
      if (index.has(id) || this.dead.has(id)) continue
      index.set(id, ids.length)
      ids.push(id)
    }
    this.snapshot = { ids, next, index }
    return this.snapshot
  }

  /** Number of materialized (stored) entries. Rows past it exist virtually. */
  get length(): number {
    return this.resolve().ids.length
  }

  /** The id at a display index, materialized or virtual. */
  idAt(position: number): string {
    const { ids, next } = this.resolve()
    return position < ids.length ? ids[position]! : String(next + position - ids.length)
  }

  /**
   * The display index of an id, or -1 if it was deleted. Virtual ids past the stored end resolve
   * to where the axis would put them.
   */
  indexOf(id: string): number {
    const { ids, next, index } = this.resolve()
    const found = index.get(id)
    if (found !== undefined) return found
    if (this.dead.has(id)) return -1
    const virtual = virtualNumber(id)
    if (virtual >= next) return ids.length + virtual - next
    // A virtual id below `next` that is neither stored nor tombstoned was never materialized here
    // but a later one was (possible after a concurrent materialization raced a delete); treat it
    // as gone rather than guessing.
    return -1
  }

  /** Where a deleted id was when it was deleted, for approximate resolution; undefined if unknown. */
  deletedIndex(id: string): number | undefined {
    return this.dead.get(id)
  }

  /** Stores entries until at least `count` are materialized. Call inside a transaction. */
  ensure(count: number): void {
    const { ids, next } = this.resolve()
    if (ids.length >= count) return
    const added: string[] = []
    for (let n = ids.length; n < count; n++) added.push(String(next + n - ids.length))
    this.order.push(added)
    this.invalidate()
  }

  /** Our own changes take effect at once; Yjs only notifies observers when the transaction ends. */
  private invalidate(): void {
    this.snapshot = undefined
  }

  /** Inserts `count` new entries before `position` and returns their ids. Call inside a transaction. */
  insert(position: number, count: number): string[] {
    // Keep a stored neighbor after the insertion point, so a concurrent materialization appends
    // after the new entries instead of between them.
    this.ensure(position + 1)
    const fresh = Array.from({ length: count }, randomId)
    this.order.insert(this.storedIndex(position), fresh)
    this.invalidate()
    return fresh
  }

  /** Deletes `count` entries starting at `position` and returns their ids. Call inside a transaction. */
  delete(position: number, count: number): string[] {
    // Materialize one past the deletion so the highest virtual id survives in the order.
    this.ensure(position + count + 1)
    const { ids } = this.resolve()
    const removed = ids.slice(position, position + count)
    removed.forEach((id, offset) => this.dead.set(id, position + offset))
    this.removeFromOrder(new Set(removed))
    this.invalidate()
    return removed
  }

  /** Moves `count` entries at `from` so they start at `to` (an index in the order after removal). */
  move(from: number, count: number, to: number): void {
    this.ensure(Math.max(from + count, to) + 1)
    const { ids } = this.resolve()
    const moving = ids.slice(from, from + count)
    this.removeFromOrder(new Set(moving))
    this.invalidate()
    // Moving keeps ids: references and cells follow the moved rows.
    this.order.insert(this.storedIndex(to), moving)
    this.invalidate()
  }

  /** The Y.Array index of the `position`th live entry (skipping duplicates and tombstones). */
  private storedIndex(position: number): number {
    const seen = new Set<string>()
    let live = 0
    let stored = 0
    for (const id of this.order) {
      if (!seen.has(id) && !this.dead.has(id)) {
        if (live === position) return stored
        live++
      }
      seen.add(id)
      stored++
    }
    return stored
  }

  private removeFromOrder(ids: Set<string>): void {
    // Delete every stored copy (concurrent materialization can store an id twice), back to front.
    const positions: number[] = []
    this.order.forEach((id, index) => {
      if (ids.has(id)) positions.push(index)
    })
    for (let index = positions.length - 1; index >= 0; index--) {
      // Coalesce adjacent positions into one delete.
      let start = positions[index]!
      let length = 1
      while (index > 0 && positions[index - 1] === start - 1) {
        start--
        length++
        index--
      }
      this.order.delete(start, length)
    }
  }
}
