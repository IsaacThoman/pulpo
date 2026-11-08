import type { FunctionDoc, SheetView } from '@pulpo/client-core/office/sheets/view'
import { ui } from '@/i18n/ui'

/** The functions Google's Σ menu and Excel's AutoSum list first. */
export const COMMON_FUNCTIONS = ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'] as const
export type CommonFunction = (typeof COMMON_FUNCTIONS)[number]

/** The function library's groups in menu order. */
const CATEGORIES = ['math', 'statistical', 'text', 'logical', 'lookup', 'array', 'datetime', 'information', 'financial', 'engineering', 'database'] as const

/** A library group's name as Google Sheets' function menus show it. */
export function functionCategoryLabel(category: string): string {
  switch (category) {
    case 'math': return ui("Math")
    case 'statistical': return ui("Statistical")
    case 'text': return ui("Text")
    case 'logical': return ui("Logical")
    case 'lookup': return ui("Lookup")
    case 'array': return ui("Array")
    case 'datetime': return ui("Date")
    case 'information': return ui("Info")
    case 'financial': return ui("Financial")
    case 'engineering': return ui("Engineering")
    case 'database': return ui("Database")
    default: return ui("Other")
  }
}

/** A common function's name as Excel's AutoSum list shows it ("Sum", "Count numbers"), in the user's language. */
export function commonFunctionLabel(name: CommonFunction): string {
  switch (name) {
    case 'SUM': return ui("Sum")
    case 'AVERAGE': return ui("Average")
    case 'COUNT': return ui("Count numbers")
    case 'MAX': return ui("Max")
    case 'MIN': return ui("Min")
  }
}

/** The documented functions grouped by library group, in menu order (functions by name). */
export function functionGroups(functions: readonly FunctionDoc[]): { category: string; functions: FunctionDoc[] }[] {
  const groups = new Map<string, FunctionDoc[]>()
  for (const doc of functions) {
    const category = doc.category ?? 'other'
    let list = groups.get(category)
    if (!list) groups.set(category, list = [])
    list.push(doc)
  }
  const order = (category: string) => {
    const index = (CATEGORIES as readonly string[]).indexOf(category)
    return index < 0 ? CATEGORIES.length : index
  }
  return [...groups.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([category, list]) => ({ category, functions: [...list].sort((a, b) => a.name.localeCompare(b.name)) }))
}

/** Whether functions can go into the active cell. CSV files keep what is typed, formulas as text. */
export function canInsertFunction(view: Pick<SheetView, 'readOnly' | 'valuesOnly'>): boolean {
  return !view.readOnly && !view.valuesOnly
}

/**
 * Starts `=NAME(` in the active cell, as picking a function in Google Sheets does. While a formula
 * is being typed, `NAME(` goes in at the caret; typed text that isn't a formula yet becomes one.
 */
export function insertFunction(view: SheetView, name: string): void {
  if (!canInsertFunction(view)) return
  const edit = view.editing
  if (edit?.text.startsWith('=')) {
    const caret = Math.min(edit.caret, edit.text.length)
    view.setEditText(`${edit.text.slice(0, caret)}${name}(${edit.text.slice(caret)}`, caret + name.length + 1)
  } else if (edit) {
    view.setEditText(`=${name}(`)
  } else {
    view.beginEdit(`=${name}(`, true)
  }
  view.focus()
}

/**
 * AutoSum with a function (Σ ▸ Sum, Average…): on one cell it starts the formula over the numbers
 * next to it, on a range it writes totals below (a refusal explains itself beside the cell). While
 * a formula is typed it inserts the name instead.
 */
export function runCommonFunction(view: SheetView, name: string): void {
  if (!canInsertFunction(view)) return
  if (view.editing) insertFunction(view, name)
  else view.autoSum(name)
  view.focus()
}
