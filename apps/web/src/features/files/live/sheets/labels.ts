import type { SheetViewLabels } from '@pulpo/client-core/office/sheets/view'
import { ui } from '@/i18n/ui'

/** Visible text the grid core draws itself, translated. */
export function sheetViewLabels(): SheetViewLabels {
  return {
    dataErrors: {
      size: ui("This range is too large to sort safely. Select a smaller range."),
      arrays: ui("Cannot sort a range containing spilled or legacy array formulas."),
      merges: ui("Cannot sort merged cells. Unmerge the cells first."),
      metadata: ui("Cannot sort this range with validation, conditional formatting, drawings, or range hyperlinks. Remove them first."),
      hidden: ui("Show manually hidden rows and remove outlines before sorting."),
      filter: ui("Cannot change this filter safely. Only value-list filters are supported."),
      tables: ui("Select cells inside a single table before sorting it."),
      keys: ui("Sort keys must be columns inside the sorted range."),
      collaboration: ui("Sorting a shared document requires an exclusive editing lock. Sort a local copy instead."),
      changed: ui("The sheet changed while preparing the sort. Try again."),
      formulas: ui("Cannot safely sort filtered formulas or formulas with references to other rows or sheets. Sort values instead."),
    },
    sortAscending: ui("Sort A to Z"),
    sortDescending: ui("Sort Z to A"),
    selectAll: ui("Select all"),
    blanks: ui("(Blanks)"),
    ok: ui("OK"),
    cancel: ui("Cancel"),
    search: ui("Search"),
    clearFilter: ui("Clear filter"),
    invalidValue: ui("This value doesn't match the data validation rules for this cell."),
    chartUnavailable: ui("This chart type can't be shown yet"),
    imageUnavailable: ui("This image can't be shown"),
    linkHint: ui("Ctrl+click to open the link"),
  }
}
