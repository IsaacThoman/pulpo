import type { KeyboardEvent } from 'react'
import { suggestColumnWidths, type DelimitedTable } from '@pulpo/client-core/office/delimited'

/** Find stops counting here so a one-letter query in a huge file stays responsive. */
export const MAX_FIND_MATCHES = 10_000
/** JSON larger than this is not pretty-printed automatically. */
const MAX_FORMAT_CHARACTERS = 5_000_000

export type { LineMatch as FindMatch } from '@pulpo/client-core/highlight'
export { findInLines } from '@pulpo/client-core/highlight'

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

/** Column widths for the grid's 12px font: about 7.5px per character plus padding and border. */
export function initialColumnWidths(table: DelimitedTable, min: number, max: number, onlyColumn?: number): number[] {
  return suggestColumnWidths(table, { characterWidth: 7.5, padding: 28, min, max, onlyColumn })
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
