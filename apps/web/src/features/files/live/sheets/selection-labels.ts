import { columnName } from '@pulpo/client-core/office/sheets'
import type { SheetView } from '@pulpo/client-core/office/sheets/view'
import { ui } from '@/i18n/ui'

/** The rows or columns of the selection's last range, which Insert and Delete act on. */
export interface LineSpan {
  kind: 'row' | 'col'
  count: number
  /** "2" or "B": the first line's name, and the last one's. */
  first: string
  last: string
}

export function lineSpan(view: Pick<SheetView, 'selection'>, kind: 'row' | 'col'): LineSpan {
  const ranges = view.selection.ranges
  const range = ranges[ranges.length - 1]!
  if (kind === 'row') return { kind, count: range.bottom - range.top + 1, first: String(range.top + 1), last: String(range.bottom + 1) }
  return { kind, count: range.right - range.left + 1, first: columnName(range.left), last: columnName(range.right) }
}

/**
 * Menu labels naming how many lines a command changes, as Google Sheets writes them: "Insert row
 * above" for one, "Insert 3 rows above" and "Delete rows 2–4" for several.
 */
export const lineLabels = {
  insertBefore: ({ kind, count }: LineSpan) => kind === 'row'
    ? (count === 1 ? ui("Insert row above") : ui("Insert {{count}} rows above", { count }))
    : (count === 1 ? ui("Insert column left") : ui("Insert {{count}} columns left", { count })),
  insertAfter: ({ kind, count }: LineSpan) => kind === 'row'
    ? (count === 1 ? ui("Insert row below") : ui("Insert {{count}} rows below", { count }))
    : (count === 1 ? ui("Insert column right") : ui("Insert {{count}} columns right", { count })),
  delete: ({ kind, count, first, last }: LineSpan) => kind === 'row'
    ? (count === 1 ? ui("Delete row") : ui("Delete rows {{first}}–{{last}}", { first, last }))
    : (count === 1 ? ui("Delete column") : ui("Delete columns {{first}}–{{last}}", { first, last })),
  hide: ({ kind, count, first, last }: LineSpan) => kind === 'row'
    ? (count === 1 ? ui("Hide row") : ui("Hide rows {{first}}–{{last}}", { first, last }))
    : (count === 1 ? ui("Hide column") : ui("Hide columns {{first}}–{{last}}", { first, last })),
  unhide: ({ kind }: LineSpan) => kind === 'row' ? ui("Unhide rows") : ui("Unhide columns"),
  resize: ({ kind, count, first, last }: LineSpan) => kind === 'row'
    ? (count === 1 ? ui("Resize row…") : ui("Resize rows {{first}}–{{last}}…", { first, last }))
    : (count === 1 ? ui("Resize column…") : ui("Resize columns {{first}}–{{last}}…", { first, last })),
  /** The Resize dialog's title: "Resize row 3", "Resize columns B–D". */
  resizeTitle: ({ kind, count, first, last }: LineSpan) => kind === 'row'
    ? (count === 1 ? ui("Resize row {{first}}", { first }) : ui("Resize rows {{first}}–{{last}}", { first, last }))
    : (count === 1 ? ui("Resize column {{first}}", { first }) : ui("Resize columns {{first}}–{{last}}", { first, last })),
  /** Edit ▸ Delete ▸ "Row 3" or "Rows 2–4". */
  deleteShort: ({ kind, count, first, last }: LineSpan) => kind === 'row'
    ? (count === 1 ? ui("Row {{first}}", { first }) : ui("Rows {{first}}–{{last}}", { first, last }))
    : (count === 1 ? ui("Column {{first}}", { first }) : ui("Columns {{first}}–{{last}}", { first, last })),
}

/** Whether any of the selected lines is hidden (by hand or by a filter), so Unhide does something. */
export function hasHiddenLines(view: Pick<SheetView, 'selection' | 'rows' | 'cols'>, kind: 'row' | 'col'): boolean {
  const axis = kind === 'row' ? view.rows : view.cols
  // A whole column selection spans a million rows: look at the first 10,000 lines only.
  let budget = 10_000
  for (const range of view.selection.ranges) {
    const [from, to] = kind === 'row' ? [range.top, range.bottom] : [range.left, range.right]
    for (let index = from; index <= Math.min(to, axis.count - 1) && budget > 0; index++, budget--) if (axis.isHidden(index)) return true
  }
  return false
}
