/** One replacement in the old text: characters `from`..`to` become `insert`. */
export interface TextEdit {
  from: number
  to: number
  insert: string
}

/** Above this many differing lines Myers stops, and unique lines anchor the match instead. */
const MAX_EDIT_DISTANCE = 4_000

/** Splits text into lines that keep their `\n`, so joining them gives the text back. */
function splitLines(text: string): string[] {
  const lines: string[] = []
  let start = 0
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', start)) {
    lines.push(text.slice(start, index + 1))
    start = index + 1
  }
  if (start < text.length) lines.push(text.slice(start))
  return lines
}

/**
 * Myers' O((N+M)D) diff of two sequences of interned lines. Returns, for each line of `a`, whether
 * it is kept, and the same for `b`; null when they differ in more than `maxDistance` lines.
 */
function myers(a: Int32Array, b: Int32Array, maxDistance: number): { keptA: Uint8Array; keptB: Uint8Array } | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, maxDistance)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= max && found < 0; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }
  if (found < 0) return null
  const keptA = new Uint8Array(n)
  const keptB = new Uint8Array(m)
  let x = n
  let y = m
  for (let d = found; d > 0; d -= 1) {
    // `trace[d]` holds V as it was before step d, indexed from k = -d - 1.
    const previous = trace[d]!
    const at = (k: number) => previous[k + d + 1]!
    const k = x - y
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1))
    const previousK = down ? k + 1 : k - 1
    const previousX = at(previousK)
    const previousY = previousX - previousK
    while (x > previousX && y > previousY) {
      x -= 1
      y -= 1
      keptA[x] = 1
      keptB[y] = 1
    }
    if (down) y -= 1
    else x -= 1
  }
  while (x > 0 && y > 0) {
    x -= 1
    y -= 1
    keptA[x] = 1
    keptB[y] = 1
  }
  return { keptA, keptB }
}

/** Longest increasing subsequence of `values`, as indexes into it (patience sorting). */
function longestIncreasing(values: readonly number[]): number[] {
  const tails: number[] = []
  const previous = new Int32Array(values.length).fill(-1)
  for (let index = 0; index < values.length; index += 1) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (values[tails[middle]!]! < values[index]!) low = middle + 1
      else high = middle
    }
    if (low > 0) previous[index] = tails[low - 1]!
    tails[low] = index
  }
  const result: number[] = []
  for (let index = tails.at(-1) ?? -1; index !== -1; index = previous[index]!) result.push(index)
  return result.reverse()
}

/**
 * Marks matching lines of `a[aStart..aEnd)` and `b[bStart..bEnd)`. Myers finds the minimal match
 * when the ranges differ in few lines; past that, lines that occur once on each side anchor the
 * match (patience diff) and the gaps between anchors are matched the same way, so a file changed
 * all over still keeps every line it did not change.
 */
function matchLines(
  a: Int32Array, b: Int32Array, keptA: Uint8Array, keptB: Uint8Array,
  aStart: number, aEnd: number, bStart: number, bEnd: number, maxDistance: number, depth = 0,
): void {
  while (aStart < aEnd && bStart < bEnd && a[aStart] === b[bStart]) keptA[aStart++] = keptB[bStart++] = 1
  while (aEnd > aStart && bEnd > bStart && a[aEnd - 1] === b[bEnd - 1]) keptA[--aEnd] = keptB[--bEnd] = 1
  if (aStart === aEnd || bStart === bEnd) return
  const matched = myers(a.subarray(aStart, aEnd), b.subarray(bStart, bEnd), maxDistance)
  if (matched) {
    keptA.set(matched.keptA, aStart)
    keptB.set(matched.keptB, bStart)
    return
  }
  if (depth > 16) return
  const counts = new Map<number, [number, number, number]>()
  for (let index = aStart; index < aEnd; index += 1) {
    const entry = counts.get(a[index]!) ?? [0, 0, -1]
    entry[0] += 1
    counts.set(a[index]!, entry)
  }
  for (let index = bStart; index < bEnd; index += 1) {
    const entry = counts.get(b[index]!)
    if (!entry) continue
    entry[1] += 1
    entry[2] = index
  }
  const anchorsA: number[] = []
  const anchorsB: number[] = []
  for (let index = aStart; index < aEnd; index += 1) {
    const entry = counts.get(a[index]!)!
    if (entry[0] === 1 && entry[1] === 1) {
      anchorsA.push(index)
      anchorsB.push(entry[2])
    }
  }
  const chain = longestIncreasing(anchorsB)
  // Nothing anchors the ranges: they are one replacement.
  if (!chain.length) return
  let lastA = aStart
  let lastB = bStart
  for (const position of chain) {
    const anchorA = anchorsA[position]!
    const anchorB = anchorsB[position]!
    matchLines(a, b, keptA, keptB, lastA, anchorA, lastB, anchorB, maxDistance, depth + 1)
    keptA[anchorA] = keptB[anchorB] = 1
    lastA = anchorA + 1
    lastB = anchorB + 1
  }
  matchLines(a, b, keptA, keptB, lastA, aEnd, lastB, bEnd, maxDistance, depth + 1)
}

function commonPrefix(left: string, right: string): number {
  const length = Math.min(left.length, right.length)
  let index = 0
  while (index < length && left.charCodeAt(index) === right.charCodeAt(index)) index += 1
  return index
}

function commonSuffix(left: string, right: string, limit: number): number {
  let index = 0
  while (index < limit && left.charCodeAt(left.length - 1 - index) === right.charCodeAt(right.length - 1 - index)) index += 1
  return index
}

/** Narrows one replacement to the characters that actually differ. */
function narrowed(from: number, removed: string, inserted: string): TextEdit | null {
  if (removed === inserted) return null
  let prefix = commonPrefix(removed, inserted)
  // Never split a surrogate pair: half of one is not a character.
  if (prefix > 0 && isHighSurrogate(removed.charCodeAt(prefix - 1))) prefix -= 1
  let suffix = commonSuffix(removed, inserted, Math.min(removed.length, inserted.length) - prefix)
  if (suffix > 0 && isLowSurrogate(removed.charCodeAt(removed.length - suffix))) suffix -= 1
  return { from: from + prefix, to: from + removed.length - suffix, insert: inserted.slice(prefix, inserted.length - suffix) }
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff

/**
 * The edits that turn `before` into `after`, in ascending order and not overlapping: unchanged
 * lines are matched first (Myers), then each changed run is narrowed to the characters that
 * differ. Applying them from last to first keeps every offset valid.
 */
export function textEdits(before: string, after: string, maxDistance = MAX_EDIT_DISTANCE): TextEdit[] {
  if (before === after) return []
  const prefix = commonPrefix(before, after)
  // Diff whole lines: back up to the start of the line the first difference is in.
  const start = prefix > 0 ? before.lastIndexOf('\n', prefix - 1) + 1 : 0
  const suffix = commonSuffix(before, after, Math.min(before.length, after.length) - prefix)
  // Diff whole lines at the end too: keep the trimmed suffix starting right after a line break.
  let end = suffix
  while (end > 0 && !(before[before.length - end - 1] === '\n' && after[after.length - end - 1] === '\n')) end -= 1
  const oldMiddle = before.slice(start, before.length - end)
  const newMiddle = after.slice(start, after.length - end)
  const oldLines = splitLines(oldMiddle)
  const newLines = splitLines(newMiddle)

  const ids = new Map<string, number>()
  const intern = (lines: string[]) => Int32Array.from(lines, (line) => {
    let id = ids.get(line)
    if (id === undefined) ids.set(line, id = ids.size)
    return id
  })
  const oldIds = intern(oldLines)
  const newIds = intern(newLines)
  const matched = { keptA: new Uint8Array(oldIds.length), keptB: new Uint8Array(newIds.length) }
  matchLines(oldIds, newIds, matched.keptA, matched.keptB, 0, oldIds.length, 0, newIds.length, maxDistance)

  const edits: TextEdit[] = []
  let oldIndex = 0
  let newIndex = 0
  let oldOffset = start
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && matched.keptA[oldIndex] && matched.keptB[newIndex]) {
      oldOffset += oldLines[oldIndex]!.length
      oldIndex += 1
      newIndex += 1
      continue
    }
    // A run of removed and inserted lines between two kept ones is one replacement.
    const from = oldOffset
    let removed = ''
    let inserted = ''
    while (oldIndex < oldLines.length && !matched.keptA[oldIndex]) {
      removed += oldLines[oldIndex]!
      oldOffset += oldLines[oldIndex]!.length
      oldIndex += 1
    }
    while (newIndex < newLines.length && !matched.keptB[newIndex]) inserted += newLines[newIndex++]!
    const edit = narrowed(from, removed, inserted)
    if (edit) edits.push(edit)
  }
  return edits
}

/** Applies edits from `textEdits` to `before`; used by tests and by callers without a Y.Text. */
export function applyTextEdits(before: string, edits: readonly TextEdit[]): string {
  let result = before
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index]!
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to)
  }
  return result
}
