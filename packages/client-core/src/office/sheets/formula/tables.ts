/** Resolving structured references (`Table1[Col]`, `[@Amount]`) against table definitions. */

import { Errors, type Area, type FormulaError } from './types.js'
import type { StructuredRef } from './tokenize.js'

/** A table (ListObject) as the engine sees it. Zero-based, inclusive, headers and totals included. */
export interface TableDefinition {
  name: string
  sheet: number
  top: number
  left: number
  bottom: number
  right: number
  headerRow: boolean
  totalsRow: boolean
  /** Column names, left to right. */
  columns: string[]
}

/**
 * The area a structured reference covers, for a formula in `row`. `#This Row` / `@` outside the
 * data rows is #VALUE!; unknown columns and missing header or totals rows are #REF!.
 */
export function structuredArea(table: TableDefinition, ref: StructuredRef, row: number): Area | FormulaError {
  const headerRow = table.headerRow ? table.top : -1
  const totalsRow = table.totalsRow ? table.bottom : -1
  const dataTop = table.top + (table.headerRow ? 1 : 0)
  const dataBottom = table.bottom - (table.totalsRow ? 1 : 0)
  const items = new Set(ref.items)
  let top: number
  let bottom: number
  if (items.has('#This Row')) {
    if (items.size > 1) return Errors.REF
    if (row < dataTop || row > dataBottom) return Errors.VALUE
    top = bottom = row
  } else if (items.has('#All')) {
    top = table.top
    bottom = table.bottom
  } else {
    const rows: number[] = []
    if (items.has('#Headers')) {
      if (headerRow < 0) return Errors.REF
      rows.push(headerRow)
    }
    if (items.has('#Data') || items.size === 0) {
      if (dataTop > dataBottom) return Errors.REF
      rows.push(dataTop, dataBottom)
    }
    if (items.has('#Totals')) {
      if (totalsRow < 0) return Errors.REF
      rows.push(totalsRow)
    }
    // [#Headers],[#Totals] without the data in between is not a rectangle.
    if (items.has('#Headers') && items.has('#Totals') && !items.has('#Data')) return Errors.REF
    top = Math.min(...rows)
    bottom = Math.max(...rows)
  }
  let left = table.left
  let right = table.right
  if (ref.firstColumn !== undefined) {
    const first = columnOffset(table, ref.firstColumn)
    const last = ref.lastColumn === undefined ? first : columnOffset(table, ref.lastColumn)
    if (first < 0 || last < 0) return Errors.REF
    left = table.left + Math.min(first, last)
    right = table.left + Math.max(first, last)
  }
  return { sheet: table.sheet, top, left, bottom, right }
}

function columnOffset(table: TableDefinition, name: string): number {
  const wanted = name.trim().toUpperCase()
  return table.columns.findIndex((column) => column.trim().toUpperCase() === wanted)
}

/** The table whose area contains a cell, if any. */
export function tableAt(tables: Iterable<TableDefinition>, sheet: number, row: number, col: number): TableDefinition | undefined {
  for (const table of tables) {
    if (table.sheet === sheet && row >= table.top && row <= table.bottom && col >= table.left && col <= table.right) return table
  }
  return undefined
}
