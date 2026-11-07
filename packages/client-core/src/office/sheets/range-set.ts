import type { CellRange } from './address.js'

export const contains = (a: CellRange, b: CellRange): boolean => a.top <= b.top && a.bottom >= b.bottom && a.left <= b.left && a.right >= b.right
export const intersects = (a: CellRange, b: CellRange): boolean => a.top <= b.bottom && a.bottom >= b.top && a.left <= b.right && a.right >= b.left
const order = (a: CellRange, b: CellRange) => a.top - b.top || a.left - b.left || a.bottom - b.bottom || a.right - b.right

/** Normalize an sqref union without enumerating cells, including whole axes. Sweep boundary
 * bands, union their intervals, then coalesce identical adjacent runs. Try both orientations
 * to avoid needless fragmentation of tall or wide shapes. Output is deterministic, disjoint,
 * and coalesced (no pair can be combined into a rectangle). Inputs are never mutated. */
export function normalizeRanges(ranges: readonly CellRange[]): CellRange[] {
  const valid = ranges.filter((r) => r.top <= r.bottom && r.left <= r.right)
  const horizontal = bands(valid)
  const vertical = bands(valid.map(transpose)).map(transpose).sort(order)
  return horizontal.length <= vertical.length ? horizontal : vertical
}

function transpose(r: CellRange): CellRange {
  return { top: r.left, bottom: r.right, left: r.top, right: r.bottom }
}

function bands(ranges: readonly CellRange[]): CellRange[] {
  const events = new Map<number, { add: CellRange[]; remove: CellRange[] }>()
  const event = (row: number) => {
    let value = events.get(row)
    if (!value) { value = { add: [], remove: [] }; events.set(row, value) }
    return value
  }
  // Give duplicate input rectangles distinct identities in the active set.
  for (const range of ranges) {
    const r = { ...range }
    event(r.top).add.push(r)
    event(r.bottom + 1).remove.push(r)
  }
  const edges = [...events.keys()].sort((a, b) => a - b)
  const active = new Set<CellRange>()
  const result: CellRange[] = []
  let previous = new Map<string, CellRange>()
  for (let i = 0; i + 1 < edges.length; i++) {
    const top = edges[i]!, bottom = edges[i + 1]! - 1
    for (const r of events.get(top)!.remove) active.delete(r)
    for (const r of events.get(top)!.add) active.add(r)
    const intervals = [...active].sort((a, b) => a.left - b.left || a.right - b.right)
    const runs: Array<{ left: number; right: number }> = []
    for (const r of intervals) {
      const last = runs.at(-1)
      if (last && r.left <= last.right + 1) last.right = Math.max(last.right, r.right)
      else runs.push({ left: r.left, right: r.right })
    }
    const next = new Map<string, CellRange>()
    for (const run of runs) {
      const key = `${run.left}:${run.right}`
      const prior = previous.get(key)
      const rect = prior ?? { top, bottom, ...run }
      if (prior) prior.bottom = bottom
      else result.push(rect)
      next.set(key, rect)
    }
    previous = next
  }
  return result.sort(order)
}

export function unionRanges(...sets: readonly (readonly CellRange[])[]): CellRange[] {
  return normalizeRanges(sets.flat())
}

/** Set difference of two sqref lists. Cost depends on rectangles, never their cell count. */
export function subtractRanges(coverage: readonly CellRange[], selection: readonly CellRange[]): CellRange[] {
  let remaining = normalizeRanges(coverage)
  for (const cut of normalizeRanges(selection)) {
    remaining = remaining.flatMap((r) => {
      if (!intersects(r, cut)) return [r]
      const top = Math.max(r.top, cut.top), bottom = Math.min(r.bottom, cut.bottom)
      const left = Math.max(r.left, cut.left), right = Math.min(r.right, cut.right)
      return [
        { ...r, bottom: top - 1 }, { ...r, top: bottom + 1 },
        { top, bottom, left: r.left, right: left - 1 }, { top, bottom, left: right + 1, right: r.right },
      ].filter((part) => part.top <= part.bottom && part.left <= part.right)
    })
  }
  return normalizeRanges(remaining)
}
