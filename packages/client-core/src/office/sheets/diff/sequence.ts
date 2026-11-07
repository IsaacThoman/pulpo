/**
 * Myers' O((N+M)·D) diff of two sequences of keys. Returns the pairs of indexes that match, in
 * order. When the sequences differ by more than `maxEdits`, gives up and returns undefined so the
 * caller can fall back to comparing by position.
 */
export function matchSequences(a: readonly string[], b: readonly string[], maxEdits = 4000): [number, number][] | undefined {
  // Common prefix and suffix first: the usual case is a few rows changed in a big sheet.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const pairs: [number, number][] = []
  for (let index = 0; index < start; index++) pairs.push([index, index])
  const middle = myers(a.slice(start, endA), b.slice(start, endB), maxEdits)
  if (!middle) return undefined
  for (const [x, y] of middle) pairs.push([x + start, y + start])
  for (let offset = 0; offset < a.length - endA; offset++) pairs.push([endA + offset, endB + offset])
  return pairs
}

function myers(a: readonly string[], b: readonly string[], maxEdits: number): [number, number][] | undefined {
  const n = a.length
  const m = b.length
  if (!n || !m) return []
  const max = Math.min(n + m, maxEdits)
  const offset = max + 1
  let v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    const next = v.slice()
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) x = v[offset + k + 1]!
      else x = v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      next[offset + k] = x
      if (x >= n && y >= m) {
        trace.push(next)
        return backtrack(trace, a, b, offset, d)
      }
    }
    v = next
  }
  return undefined
}

function backtrack(trace: Int32Array[], a: readonly string[], b: readonly string[], offset: number, edits: number): [number, number][] {
  const pairs: [number, number][] = []
  let x = a.length
  let y = b.length
  for (let d = edits; d >= 0; d--) {
    const v = trace[d]!
    const k = x - y
    let previousK: number
    if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) previousK = k + 1
    else previousK = k - 1
    const previousX = d === 0 ? 0 : v[offset + previousK]!
    const previousY = previousX - previousK
    while (x > previousX && y > previousY) {
      x--
      y--
      pairs.push([x, y])
    }
    if (d > 0) {
      x = previousX
      y = previousY
    }
  }
  return pairs.reverse()
}
