/**
 * Pairing the cells of two versions of a notebook, for applying a new version as a minimal diff
 * and for showing what changed. Cells pair by nbformat id first, then by identical content in
 * order, and then, between those, by likeness.
 */

/** How alike two sources are, from 0 to 1: the share of lines they have in common. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const left = a.split('\n')
  const right = b.split('\n')
  const counts = new Map<string, number>()
  for (const line of left) counts.set(line, (counts.get(line) ?? 0) + 1)
  let common = 0
  for (const line of right) {
    const count = counts.get(line) ?? 0
    if (count > 0) {
      common += 1
      counts.set(line, count - 1)
    }
  }
  return (2 * common) / (left.length + right.length)
}

/** Pairs each new cell with the existing cell it is a new version of: by id, then same content, then likeness in place. */
export function matchCells(
  existing: readonly { key: string; id: string | undefined; type: string; source: string }[],
  incoming: readonly { id: string | undefined; type: string; source: string }[],
): (string | null)[] {
  const result: (string | null)[] = incoming.map(() => null)
  const used = new Set<string>()
  const byId = new Map<string, string>()
  for (const cell of existing) if (cell.id !== undefined && !byId.has(cell.id)) byId.set(cell.id, cell.key)
  incoming.forEach((cell, index) => {
    const key = cell.id !== undefined ? byId.get(cell.id) : undefined
    if (key && !used.has(key)) {
      result[index] = key
      used.add(key)
    }
  })
  // Unchanged cells, in order: the longest common subsequence of what remains.
  const left = existing.filter((cell) => !used.has(cell.key))
  const rightIndexes = incoming.flatMap((_, index) => (result[index] === null ? [index] : []))
  const same = (a: (typeof left)[number], b: (typeof incoming)[number]) => a.type === b.type && a.source === b.source
  if (left.length * rightIndexes.length <= 4_000_000) {
    const rows = left.length + 1
    const columns = rightIndexes.length + 1
    const table = new Uint32Array(rows * columns)
    for (let i = left.length - 1; i >= 0; i -= 1) {
      for (let j = rightIndexes.length - 1; j >= 0; j -= 1) {
        table[i * columns + j] = same(left[i]!, incoming[rightIndexes[j]!]!)
          ? table[(i + 1) * columns + j + 1]! + 1
          : Math.max(table[(i + 1) * columns + j]!, table[i * columns + j + 1]!)
      }
    }
    for (let i = 0, j = 0; i < left.length && j < rightIndexes.length;) {
      if (same(left[i]!, incoming[rightIndexes[j]!]!)) {
        result[rightIndexes[j]!] = left[i]!.key
        used.add(left[i]!.key)
        i += 1
        j += 1
      } else if (table[(i + 1) * columns + j]! >= table[i * columns + j + 1]!) i += 1
      else j += 1
    }
  }
  // Edited cells: between two matched cells, pair what is left in order when it is alike enough.
  const position = new Map(existing.map((cell, index) => [cell.key, index]))
  let lastExisting = -1
  let pending: number[] = []
  const flush = (limit: number) => {
    let cursor = lastExisting + 1
    for (const index of pending) {
      const cell = incoming[index]!
      let best: { key: string; score: number; at: number } | null = null
      for (let at = cursor; at < limit; at += 1) {
        const candidate = existing[at]!
        if (used.has(candidate.key)) continue
        const score = similarity(candidate.source, cell.source) + (candidate.type === cell.type ? 0.1 : 0)
        if (score >= 0.4 && (!best || score > best.score)) best = { key: candidate.key, score, at }
      }
      if (best) {
        result[index] = best.key
        used.add(best.key)
        cursor = best.at + 1
      }
    }
    pending = []
  }
  incoming.forEach((_, index) => {
    const key = result[index] ?? null
    if (key === null) {
      pending.push(index)
      return
    }
    const at = position.get(key)!
    if (at > lastExisting) {
      flush(at)
      lastExisting = at
    }
  })
  flush(existing.length)
  return result
}

/** Indexes of the longest increasing run of `values` (cells that keep their places). */
export function longestIncreasing(values: readonly number[]): Set<number> {
  const tails: number[] = []
  const previous = new Array<number>(values.length).fill(-1)
  values.forEach((value, index) => {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (values[tails[middle]!]! < value) low = middle + 1
      else high = middle
    }
    if (low > 0) previous[index] = tails[low - 1]!
    tails[low] = index
  })
  const kept = new Set<number>()
  for (let index = tails[tails.length - 1] ?? -1; index >= 0; index = previous[index]!) kept.add(index)
  return kept
}

