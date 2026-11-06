import type { EditorBridgeState } from './bridge'
import type { SheetCommand } from './protocol'
import type { NativeToolbarItem, NativeToolbarOption } from './textToolbar'

type SheetOption = Omit<NativeToolbarOption, 'command'> & { command: SheetCommand }
type SheetMenu = Omit<NativeToolbarItem, 'options'> & { options: readonly SheetOption[] }
type SheetItem = (Omit<NativeToolbarItem, 'command' | 'options'> & { command: SheetCommand; options?: undefined }) | SheetMenu

/**
 * The spreadsheet editor's bar, sized for a phone: the commands people use most as buttons, and
 * the rest grouped in menus (iOS draws them as native menus, Android as action sheets).
 */
export const SHEET_TOOLBAR: ReadonlyArray<SheetItem> = [
  { command: 'undo', label: 'Undo', systemImage: 'arrow.uturn.backward' },
  { command: 'redo', label: 'Redo', systemImage: 'arrow.uturn.forward' },
  { command: 'bold', label: 'Bold', systemImage: 'bold' },
  { command: 'italic', label: 'Italic', systemImage: 'italic' },
  { command: 'fill', label: 'Fill color', systemImage: 'paintbrush', options: [
    { command: 'fillNone', label: 'No fill', systemImage: 'circle.slash' },
    { command: 'fillYellow', label: 'Yellow', systemImage: 'circle.fill' },
    { command: 'fillGreen', label: 'Green', systemImage: 'circle.fill' },
    { command: 'fillBlue', label: 'Blue', systemImage: 'circle.fill' },
    { command: 'fillRed', label: 'Red', systemImage: 'circle.fill' },
    { command: 'fillGray', label: 'Gray', systemImage: 'circle.fill' },
  ] },
  { command: 'align', label: 'Alignment and wrapping', systemImage: 'text.alignleft', options: [
    { command: 'alignLeft', label: 'Align left', systemImage: 'text.alignleft' },
    { command: 'alignCenter', label: 'Align center', systemImage: 'text.aligncenter' },
    { command: 'alignRight', label: 'Align right', systemImage: 'text.alignright' },
    { command: 'wrap', label: 'Wrap text', systemImage: 'arrow.turn.down.left' },
  ] },
  { command: 'numberFormat', label: 'Number format', systemImage: 'number', options: [
    { command: 'formatGeneral', label: 'Automatic', systemImage: 'sparkles' },
    { command: 'formatNumber', label: 'Number (1,000.12)', systemImage: 'number' },
    { command: 'formatCurrency', label: 'Currency ($1,000.12)', systemImage: 'dollarsign' },
    { command: 'formatPercent', label: 'Percent (10.12%)', systemImage: 'percent' },
    { command: 'formatDate', label: 'Date (9/26/2008)', systemImage: 'calendar' },
    { command: 'formatText', label: 'Plain text', systemImage: 'textformat' },
  ] },
  { command: 'rowsColumns', label: 'Rows and columns', systemImage: 'tablecells', options: [
    { command: 'insertRowAbove', label: 'Insert row above', systemImage: 'arrow.up.to.line' },
    { command: 'insertRowBelow', label: 'Insert row below', systemImage: 'arrow.down.to.line' },
    { command: 'insertColumnLeft', label: 'Insert column left', systemImage: 'arrow.left.to.line' },
    { command: 'insertColumnRight', label: 'Insert column right', systemImage: 'arrow.right.to.line' },
    { command: 'deleteRow', label: 'Delete row', systemImage: 'trash' },
    { command: 'deleteColumn', label: 'Delete column', systemImage: 'trash' },
  ] },
  { command: 'freezeRow', label: 'Freeze first row', systemImage: 'snowflake' },
  { command: 'sort', label: 'Sort', systemImage: 'arrow.up.arrow.down', options: [
    { command: 'sortAscending', label: 'Sort A to Z', systemImage: 'arrow.down' },
    { command: 'sortDescending', label: 'Sort Z to A', systemImage: 'arrow.up' },
  ] },
  { command: 'filter', label: 'Filter', systemImage: 'line.3.horizontal.decrease.circle' },
  { command: 'find', label: 'Find', systemImage: 'magnifyingglass' },
]

/** Commands that change formats (wrapping included), which CSV and TSV files don't keep. */
const FORMAT_COMMANDS = new Set<string>(SHEET_TOOLBAR.flatMap((item) => (
  ['bold', 'italic', 'fill', 'align', 'numberFormat'].includes(item.command) ? [item.command, ...(item.options ?? []).map((option) => option.command)] : []
)))

/** A menu's command when `command` is a menu rather than one of its choices. */
export function sheetToolbarMenu(command: string): SheetMenu | null {
  const item = SHEET_TOOLBAR.find((entry) => entry.command === command)
  return item?.options ? item : null
}

/** What a spreadsheet's toolbar shows as on or unavailable. */
export function sheetToolbarState(state: EditorBridgeState): { active: string[]; disabled: string[] } {
  const sheet = state.sheet
  if (!sheet) return { active: [], disabled: [] }
  return {
    active: [...sheet.active],
    disabled: [
      ...!sheet.canUndo ? ['undo'] : [],
      ...!sheet.canRedo ? ['redo'] : [],
      ...sheet.valuesOnly ? FORMAT_COMMANDS : [],
    ],
  }
}
