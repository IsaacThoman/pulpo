import type { KeyboardEvent } from 'react'
import type { DelimitedTable } from '@pulpo/client-core/office/delimited'

/** Find stops counting here so a one-letter query in a huge file stays responsive. */
export const MAX_FIND_MATCHES = 10_000
/** JSON larger than this is not pretty-printed automatically. */
const MAX_FORMAT_CHARACTERS = 5_000_000

export interface FindMatch {
  line: number
  start: number
  end: number
}

/** Case-insensitive matches of `query` in each line, up to `limit`. */
export function findInLines(lines: readonly string[], query: string, limit = MAX_FIND_MATCHES): FindMatch[] {
  const needle = query.toLowerCase()
  if (!needle) return []
  const matches: FindMatch[] = []
  for (let line = 0; line < lines.length && matches.length < limit; line += 1) {
    const haystack = lines[line]!.toLowerCase()
    // Lower-casing can change length (İ); such lines are searched as written.
    const text = haystack.length === lines[line]!.length ? haystack : lines[line]!
    let from = 0
    while (matches.length < limit) {
      const found = text.indexOf(needle, from)
      if (found < 0) break
      matches.push({ line, start: found, end: found + needle.length })
      from = found + Math.max(1, needle.length)
    }
  }
  return matches
}

/** JSON pretty-printed with two spaces, or null when the text isn't JSON (or is too large). */
export function formatJson(text: string): string | null {
  if (text.length > MAX_FORMAT_CHARACTERS) return null
  try {
    const formatted = JSON.stringify(JSON.parse(text), null, 2)
    return formatted === text ? null : formatted
  } catch {
    return null
  }
}

/**
 * Opens find with Cmd/Ctrl+F (and steps through matches with Cmd/Ctrl+G) while focus is inside
 * the viewer, so the browser's own find still works everywhere else on the page.
 */
export function useFindShortcut(open: () => void, step: (direction: 1 | -1) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'f') {
      event.preventDefault()
      open()
    } else if (key === 'g') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    }
  }
}

/** Steps a match index forward or back, wrapping at the ends. */
export function stepIndex(current: number, total: number, direction: 1 | -1): number {
  if (total === 0) return 0
  return (current + direction + total) % total
}

/** Grid find stops at this many matching rows. */
export const MAX_FIND_ROWS = 10_000

/** Rows sampled to size columns to their content. */
const WIDTH_SAMPLE_ROWS = 200

/**
 * Column widths fitted to the header and the first rows' text, clamped to `[min, max]`. With
 * `onlyColumn`, only that column is measured (the others keep `min`).
 */
export function initialColumnWidths(table: DelimitedTable, min: number, max: number, onlyColumn?: number): number[] {
  const characters = new Array<number>(table.columnCount).fill(0)
  const rows = Math.min(table.rowCount, WIDTH_SAMPLE_ROWS)
  for (let row = 0; row < rows; row += 1) {
    const cells = table.row(row)
    for (let column = 0; column < table.columnCount; column += 1) {
      if (onlyColumn !== undefined && column !== onlyColumn) continue
      const value = cells[column] ?? ''
      // Long values are truncated anyway; only the first line counts.
      const length = Math.min(80, value.split('\n', 1)[0]!.length)
      if (length > characters[column]!) characters[column] = length
    }
  }
  // About 7.5px per character at the grid's 12px font, plus the cell's padding and border.
  return characters.map((count) => Math.min(max, Math.max(min, Math.round(count * 7.5 + 28))))
}

/**
 * The first and last column to render for a horizontal viewport, given each column's starting
 * offset (`offsets` has one more entry: the total width) and a margin on both sides.
 */
export function columnWindow(offsets: readonly number[], left: number, width: number, margin: number): [number, number] {
  const count = offsets.length - 1
  if (count <= 0) return [0, -1]
  const from = Math.max(0, left - margin)
  const to = left + width + margin
  let first = 0
  while (first < count - 1 && offsets[first + 1]! <= from) first += 1
  let last = first
  while (last < count - 1 && offsets[last + 1]! < to) last += 1
  return [first, last]
}
