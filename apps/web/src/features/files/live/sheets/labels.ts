import type { SheetViewLabels } from '@pulpo/client-core/office/sheets/view'
import { ui } from '@/i18n/ui'

/** Visible text the grid core draws itself, translated. */
export function sheetViewLabels(): SheetViewLabels {
  return {
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
