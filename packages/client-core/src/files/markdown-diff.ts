export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string }
export type DiffRow = DiffLine | { kind: 'gap'; count: number }

/** Beyond this many line comparisons the diff is skipped; the dialog then summarizes instead. */
const MAX_COMPARISONS = 4_000_000

function lines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
}

/** Lines that differ only by trailing whitespace count as unchanged, matching the server's check. */
const same = (left: string, right: string) => left.trimEnd() === right.trimEnd()

/** Line-level diff (longest common subsequence), or null when the files are too large to compare. */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = lines(before)
  const b = lines(after)
  let start = 0
  while (start < a.length && start < b.length && same(a[start]!, b[start]!)) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && same(a[endA - 1]!, b[endB - 1]!)) {
    endA -= 1
    endB -= 1
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  if (midA.length * midB.length > MAX_COMPARISONS) return null
  const width = midB.length + 1
  const table = new Uint32Array((midA.length + 1) * width)
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = same(midA[i]!, midB[j]!)
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }
  const middle: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < midA.length && j < midB.length) {
    if (same(midA[i]!, midB[j]!)) {
      middle.push({ kind: 'same', text: midB[j]! })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      middle.push({ kind: 'removed', text: midA[i]! })
      i += 1
    } else {
      middle.push({ kind: 'added', text: midB[j]! })
      j += 1
    }
  }
  while (i < midA.length) middle.push({ kind: 'removed', text: midA[i++]! })
  while (j < midB.length) middle.push({ kind: 'added', text: midB[j++]! })
  return [
    ...a.slice(0, start).map((text) => ({ kind: 'same' as const, text })),
    ...middle,
    ...b.slice(endB).map((text) => ({ kind: 'same' as const, text })),
  ]
}

/** Keeps changed lines with a little context and folds long unchanged runs into gaps. */
export function diffRows(diff: DiffLine[], context = 2): DiffRow[] {
  const keep = diff.map(() => false)
  diff.forEach((line, index) => {
    if (line.kind === 'same') return
    for (let offset = -context; offset <= context; offset += 1) {
      if (diff[index + offset]) keep[index + offset] = true
    }
  })
  const rows: DiffRow[] = []
  let skipped = 0
  diff.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) rows.push({ kind: 'gap', count: skipped })
      skipped = 0
      rows.push(line)
    } else {
      skipped += 1
    }
  })
  if (skipped) rows.push({ kind: 'gap', count: skipped })
  return rows
}
