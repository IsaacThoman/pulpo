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
 * once both append the same ids; the first occurrence wins and later duplicates are ignored. A row
 * one of them inserted next to its copy is moved to the same place beside the winning copy (see
 * `rebuild`), so the insertion lands where it was made.
 *
 * Inserted rows get random ids (never all digits). Deleted ids are tombstoned with the index they
 * had and their surviving neighbors, both so they never come back (a concurrent materialization
 * can re-append a deleted virtual id) and so references to them can be resolved (a range whose
 * last row was deleted concurrently shrinks to the row before it, wherever that row is now).
 */

/**
 * A deleted id: the index it had, and the ids of the nearest entries that survived the deletion
 * before (`p`) and after (`n`) it. Older documents stored just the index.
 */
export type Tombstone = number | { i: number; p?: string; n?: string }

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
  /** For each of `ids`, its position in the Y.Array. */
  readonly stored: readonly number[]
  /** Next virtual id: the axis continues with `next`, `next + 1`, … past `ids`. */
  readonly next: number
  /** Index of each live id. */
  readonly index: ReadonlyMap<string, number>
}

interface MutableSnapshot {
  ids: string[]
  stored: number[]
  next: number
  index: Map<string, number>
}

export class Axis {
  private snapshot: MutableSnapshot | undefined

  constructor(
    readonly order: Y.Array<string>,
    /** Tombstones: deleted id → where it was when it was deleted. */
    readonly dead: Y.Map<Tombstone>,
    /**
     * Stores entries in chunks of this many. Two replicas storing the same virtual ids at once
     * keep both copies until one is ignored, and a row inserted next to a copy that loses can end
     * up on the wrong side of it; storing well ahead of where people work keeps that race far
     * past the data.
     */
    readonly chunk = 1,
  ) {
    order.observe(() => this.invalidate())
    dead.observe(() => this.invalidate())
  }

  /** The current resolved order. Cached until the axis changes. */
  resolve(): AxisSnapshot {
    if (this.snapshot) return this.snapshot
    return this.rebuild()
  }

  /**
   * Resolves the stored order. Duplicate copies after the first are dropped, but an entry that
   * was inserted right before a losing copy (and the run of inserted entries before it) belonged
   * before that row: it moves to just before the winning copy. Otherwise a row inserted at the
   * start of a chunk two replicas materialized at once would land a whole chunk further down.
   */
  private rebuild(): MutableSnapshot {
    const order = this.order.toArray()
    let next = 0
    for (const [id] of this.dead) next = Math.max(next, virtualNumber(id) + 1)
    // Which copies lose, and which ids have more than one copy.
    const seen = new Set<string>()
    const duplicated = new Set<string>()
    const losing: boolean[] = new Array(order.length).fill(false)
    order.forEach((id, position) => {
      next = Math.max(next, virtualNumber(id) + 1)
      if (this.dead.has(id)) return
      if (seen.has(id)) {
        losing[position] = true
        duplicated.add(id)
      } else seen.add(id)
    })
    // Entries to move: going backwards, a losing copy anchors the inserted entries right before it.
    let moved: Map<string, number[]> | undefined
    const movedPositions = new Set<number>()
    if (duplicated.size) {
      moved = new Map()
      const anchorOf: (string | undefined)[] = new Array(order.length)
      let anchor: string | undefined
      for (let position = order.length - 1; position >= 0; position--) {
        const id = order[position]!
        if (this.dead.has(id)) continue
        if (losing[position]) anchor = id
        else if (anchor !== undefined && !duplicated.has(id) && virtualNumber(id) < 0) anchorOf[position] = anchor
        else anchor = undefined
      }
      anchorOf.forEach((target, position) => {
        if (target === undefined) return
        movedPositions.add(position)
        const list = moved!.get(target)
        if (list) list.push(position)
        else moved!.set(target, [position])
      })
    }
    const ids: string[] = []
    const stored: number[] = []
    const index = new Map<string, number>()
    const add = (position: number) => {
      index.set(order[position]!, ids.length)
      ids.push(order[position]!)
      stored.push(position)
    }
    const placed = new Set<string>()
    order.forEach((id, position) => {
      if (this.dead.has(id) || losing[position] || placed.has(id)) return
      if (movedPositions.has(position)) return
      for (const before of moved?.get(id) ?? []) add(before)
      placed.add(id)
      add(position)
    })
    this.snapshot = { ids, stored, next, index }
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

  /** Where a deleted id was when it was deleted; undefined if it wasn't deleted. */
  deletedIndex(id: string): number | undefined {
    const tombstone = this.dead.get(id)
    return typeof tombstone === 'number' ? tombstone : tombstone?.i
  }

  /**
   * Where a deleted range edge resolves to now: for a start edge the entry that followed it, for
   * an end edge the one before it (Excel shrinks a range whose edge is deleted). Found through the
   * neighbors recorded when it was deleted, so deletions made elsewhere since then (even of those
   * neighbors) don't shift it. Undefined if the id wasn't deleted; -1 if nothing precedes an end.
   */
  deletedPosition(id: string, side: 'start' | 'end'): number | undefined {
    const visited = new Set<string>()
    let current = id
    for (;;) {
      const tombstone = this.dead.get(current)
      if (tombstone === undefined) return undefined
      if (typeof tombstone === 'number') return side === 'start' ? tombstone : tombstone - 1
      const neighbor = side === 'start' ? tombstone.n : tombstone.p
      if (neighbor === undefined) return side === 'start' ? tombstone.i : -1
      const found = this.indexOf(neighbor)
      if (found >= 0) return found
      // The neighbor was deleted too: continue from its own tombstone.
      if (visited.has(neighbor) || !this.dead.has(neighbor)) return side === 'start' ? tombstone.i : tombstone.i - 1
      visited.add(current)
      current = neighbor
    }
  }

  /** Stores entries until at least `count` are materialized. Call inside a transaction. */
  ensure(count: number): void {
    const { ids, next } = this.resolve()
    if (ids.length >= count) return
    // Round up to the next chunk boundary (deterministic, so concurrent extensions agree).
    const target = Math.ceil(count / this.chunk) * this.chunk
    const added: string[] = []
    for (let n = ids.length; n < target; n++) added.push(String(next + n - ids.length))
    const start = this.order.length
    this.order.push(added)
    // Appending virtual ids extends the snapshot as it is; no need to rebuild it (imports call
    // this for every row they touch).
    const snapshot = this.snapshot!
    added.forEach((id, offset) => {
      snapshot.index.set(id, snapshot.ids.length)
      snapshot.ids.push(id)
      snapshot.stored.push(start + offset)
    })
    snapshot.next += added.length
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
    const before = position > 0 ? ids[position - 1] : undefined
    const after = this.idAt(position + count)
    removed.forEach((id, offset) => this.dead.set(id, { i: position + offset, ...(before !== undefined ? { p: before } : {}), n: after }))
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

  /** The Y.Array index of the `position`th live entry, or the end. */
  private storedIndex(position: number): number {
    const { stored } = this.resolve()
    return position < stored.length ? stored[position]! : this.order.length
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
