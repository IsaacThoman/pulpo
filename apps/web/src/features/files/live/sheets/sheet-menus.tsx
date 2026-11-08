import {
  AlignLeft,
  ArrowDownAZ,
  Bold,
  ClipboardPaste,
  Copy,
  Eye,
  Funnel,
  Hash,
  ImagePlus,
  Link2,
  ListChecks,
  MessageSquarePlus,
  Paintbrush,
  Plus,
  RemoveFormatting,
  RotateCw,
  Scissors,
  Search,
  Sheet,
  Sigma,
  Snowflake,
  SquareChevronDown,
  TableCellsMerge,
  Trash2,
  Type,
  WrapText,
} from 'lucide-react'
import { columnName } from '@pulpo/client-core/office/sheets'
import { alternatingRowsRule, type SheetView } from '@pulpo/client-core/office/sheets/view'
import { ui } from '@/i18n/ui'
import { isAppleShortcut } from '../../browser/shortcuts'
import { separator, type MenuDefinition, type MenuEntry } from '../chrome/menu'
import type { ShortcutSpec } from '../chrome/shortcuts'
import { helpMenu, undoRedoEntries } from '../chrome/standard-menus'
import { FIND_SHORTCUT } from '../chrome/use-editor-shortcuts'
import { zoomMenu } from '../chrome/zoom'
import type { ConditionalTab } from './ConditionalFormatDialog'
import { AllFunctions } from './FunctionMenu'
import { canInsertFunction, COMMON_FUNCTIONS, runCommonFunction } from './functions'
import { NUMBER_FORMATS, numberFormatCode } from './number-formats'
import { lineLabels, lineSpan } from './selection-labels'

/** What the menus open or run outside the grid: dialogs, the file picker, the clipboard. */
export interface SheetMenuActions {
  cut: () => void
  copy: () => void
  paste: (mode?: 'values' | 'formats') => void
  find: () => void
  link: () => void
  note: () => void
  image: () => void
  shortcuts: () => void
  customNumberFormat: () => void
  validation: (preset?: 'dropdown') => void
  conditional: (tab?: ConditionalTab) => void
  sortRange: () => void
  resize: (kind: 'row' | 'col') => void
}

/**
 * Keys the grid takes with Ctrl on every platform (the format keys, Ctrl+`): Cmd+Shift+4 is a
 * screenshot and Cmd+` switches windows on a Mac, so menus only show them elsewhere.
 */
export function controlShortcut(spec: Omit<ShortcutSpec, 'mod'>): ShortcutSpec | undefined {
  return isAppleShortcut() ? undefined : { ...spec, mod: true }
}

const withShortcut = (shortcut: ShortcutSpec | undefined) => shortcut ? { shortcut } : {}

export const CUT_SHORTCUT: ShortcutSpec = { key: 'x', mod: true }
export const COPY_SHORTCUT: ShortcutSpec = { key: 'c', mod: true }
export const PASTE_SHORTCUT: ShortcutSpec = { key: 'v', mod: true }
export const PASTE_VALUES_SHORTCUT: ShortcutSpec = { key: 'v', mod: true, shift: true }
export const LINK_SHORTCUT: ShortcutSpec = { key: 'k', mod: true }
export const NOTE_SHORTCUT: ShortcutSpec = { key: 'F2', shift: true }
export const FILTER_SHORTCUT: ShortcutSpec = { key: 'l', mod: true, shift: true }
export const CLEAR_FORMATTING_SHORTCUT: ShortcutSpec = { key: '\\', mod: true }
export const CLEAR_SHORTCUT: ShortcutSpec = { key: 'Delete' }
/** The format shortcuts' digits (by key position), as Google and Excel bind them. */
export const QUICK_FORMAT_DIGITS = { number: '1', time: '2', date: '3', currency: '4', percent: '5', scientific: '6', general: '`' } as const

/** Format ▸ Rotation: Excel's text rotation (degrees counterclockwise; 91–180 clockwise; 255 stacked). */
const ROTATIONS: { id: string; label: () => string; rotation: number }[] = [
  { id: 'rotation-none', label: () => ui("None"), rotation: 0 },
  { id: 'rotation-tilt-up', label: () => ui("Tilt up"), rotation: 45 },
  { id: 'rotation-tilt-down', label: () => ui("Tilt down"), rotation: 135 },
  { id: 'rotation-stack', label: () => ui("Stack vertically"), rotation: 255 },
  { id: 'rotation-up', label: () => ui("Rotate up"), rotation: 90 },
  { id: 'rotation-down', label: () => ui("Rotate down"), rotation: 180 },
]

const FONT_SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36]

/** Cut, Copy, Paste and Paste special, as the Edit menu and the cell menu list them. */
export function clipboardEntries(view: SheetView, actions: Pick<SheetMenuActions, 'cut' | 'copy' | 'paste'>): MenuEntry[] {
  const state = view.getState()
  const canEdit = !state.readOnly
  return [
    { type: 'item', id: 'cut', label: ui("Cut"), icon: Scissors, shortcut: CUT_SHORTCUT, disabled: !canEdit, onSelect: actions.cut },
    { type: 'item', id: 'copy', label: ui("Copy"), icon: Copy, shortcut: COPY_SHORTCUT, onSelect: actions.copy },
    { type: 'item', id: 'paste', label: ui("Paste"), icon: ClipboardPaste, shortcut: PASTE_SHORTCUT, disabled: !canEdit, onSelect: () => actions.paste() },
    {
      type: 'submenu',
      id: 'paste-special',
      label: ui("Paste special"),
      disabled: !canEdit,
      items: [
        { type: 'item', id: 'paste-values', label: ui("Values only"), shortcut: PASTE_VALUES_SHORTCUT, onSelect: () => actions.paste('values') },
        // CSV keeps no formats.
        ...(state.valuesOnly ? [] : [{ type: 'item', id: 'paste-formats', label: ui("Format only"), onSelect: () => actions.paste('formats') } satisfies MenuEntry]),
      ],
    },
  ]
}

/** Format ▸ Number: the formats with the current one checked, then a custom code. */
export function numberFormatEntries(view: SheetView, customNumberFormat: () => void): MenuEntry[] {
  const current = view.getState().activeStyle.numFmt
  const disabled = view.readOnly || view.valuesOnly
  const entries: MenuEntry[] = []
  NUMBER_FORMATS.forEach((format, index) => {
    if (index > 0 && NUMBER_FORMATS[index - 1]!.group !== format.group) entries.push(separator)
    const code = numberFormatCode(view, format)
    const key = format.quick && QUICK_FORMAT_DIGITS[format.quick]
    entries.push({
      type: 'item',
      id: `number-${format.id}`,
      label: format.label(),
      radio: true,
      checked: current === code,
      disabled,
      ...withShortcut(key ? controlShortcut({ key, shift: true }) : undefined),
      onSelect: () => view.setNumberFormat(code),
    })
  })
  entries.push(separator, { type: 'item', id: 'number-custom', label: ui("Custom number format…"), disabled, onSelect: customNumberFormat })
  return entries
}

/** Insert ▸ Function, as Google Sheets lists it: the common functions, then each group's list. */
export function functionMenuEntry(view: SheetView): MenuEntry {
  return {
    type: 'submenu',
    id: 'insert-function',
    label: ui("Function"),
    icon: Sigma,
    disabled: !canInsertFunction(view),
    items: [
      ...COMMON_FUNCTIONS.map((name): MenuEntry => ({ type: 'item', id: `function-${name.toLowerCase()}`, label: name, onSelect: () => runCommonFunction(view, name) })),
      separator,
      // Groups are long lists: they scroll in their own submenus.
      { type: 'custom', id: 'function-categories', render: () => <AllFunctions view={view} /> },
    ],
  }
}

/**
 * Format ▸ Alternating colors: banded rows over the selection, or over the data around a single
 * selected cell (Google picks the range the same way).
 */
export function addAlternatingColors(view: SheetView): boolean {
  const ranges = view.selection.ranges
  const range = ranges[ranges.length - 1]!
  if (ranges.length === 1 && range.top === range.bottom && range.left === range.right) {
    const region = view.currentRegion(range.top, range.left)
    if (region.top !== region.bottom || region.left !== region.right) view.select(region, { active: view.selection.active, scroll: false })
  }
  return view.addConditionalRule(alternatingRowsRule())
}

/** The spreadsheet's menu bar after File: Edit, View, Insert, Format, Data and Help, as Google Sheets has them. */
export function sheetMenus(view: SheetView, file: MenuDefinition, actions: SheetMenuActions): MenuDefinition[] {
  return [
    file,
    {
      id: 'edit',
      label: ui("Edit"),
      items: () => {
        const current = view.getState()
        const canEdit = !current.readOnly
        const shape = current.selectionShape
        return [
          ...undoRedoEntries({ undo: () => view.undo(), redo: () => view.redo(), canUndo: canEdit && current.canUndo, canRedo: canEdit && current.canRedo }),
          separator,
          ...clipboardEntries(view, actions),
          separator,
          {
            type: 'submenu',
            id: 'delete',
            label: ui("Delete"),
            icon: Trash2,
            disabled: !canEdit,
            items: [
              { type: 'item', id: 'delete-values', label: ui("Values"), shortcut: CLEAR_SHORTCUT, onSelect: () => view.clearContents() },
              ...(shape === 'cells' || shape === 'rows' ? [{ type: 'item', id: 'delete-rows', label: lineLabels.deleteShort(lineSpan(view, 'row')), onSelect: () => view.deleteLines('row') } satisfies MenuEntry] : []),
              ...(shape === 'cells' || shape === 'columns' ? [{ type: 'item', id: 'delete-columns', label: lineLabels.deleteShort(lineSpan(view, 'col')), onSelect: () => view.deleteLines('col') } satisfies MenuEntry] : []),
              ...(current.activeNote && !current.valuesOnly ? [{ type: 'item', id: 'delete-note', label: ui("Note"), onSelect: () => view.setNote(undefined) } satisfies MenuEntry] : []),
            ],
          },
          separator,
          { type: 'item', id: 'find', label: ui("Find and replace"), icon: Search, shortcut: FIND_SHORTCUT, onSelect: actions.find },
        ]
      },
    },
    {
      id: 'view',
      label: ui("View"),
      items: () => {
        const current = view.getState()
        const frozen = current.frozen
        const sheetOptions = current.readOnly || current.valuesOnly
        return [
          {
            type: 'submenu',
            id: 'show',
            label: ui("Show"),
            icon: Eye,
            items: [
              { type: 'item', id: 'show-gridlines', label: ui("Gridlines"), checked: current.showGridLines, disabled: sheetOptions, onSelect: () => view.setViewOption('showGridLines', !current.showGridLines) },
              { type: 'item', id: 'show-formulas', label: ui("Formulas"), checked: current.showFormulas, ...withShortcut(controlShortcut({ key: '`' })), onSelect: () => view.setShowFormulas(!current.showFormulas) },
              { type: 'item', id: 'show-headings', label: ui("Headings"), checked: current.showHeadings, disabled: sheetOptions, onSelect: () => view.setViewOption('showHeadings', !current.showHeadings) },
            ],
          },
          {
            type: 'submenu',
            id: 'freeze',
            label: ui("Freeze"),
            icon: Snowflake,
            disabled: current.readOnly,
            items: [
              { type: 'item', id: 'freeze-none', label: ui("No frozen rows or columns"), onSelect: () => view.freeze(0, 0) },
              { type: 'item', id: 'freeze-row', label: ui("Freeze first row"), onSelect: () => view.freeze(1, frozen.cols) },
              { type: 'item', id: 'freeze-column', label: ui("Freeze first column"), onSelect: () => view.freeze(frozen.rows, 1) },
              { type: 'item', id: 'freeze-cell', label: ui("Freeze up to the current cell"), onSelect: () => view.freeze() },
            ],
          },
          separator,
          zoomMenu({ zoom: current.zoom, onZoom: (zoom) => view.setZoom(zoom) }),
        ]
      },
    },
    {
      id: 'insert',
      label: ui("Insert"),
      items: () => {
        const current = view.getState()
        const canEdit = !current.readOnly
        const formats = canEdit && !current.valuesOnly
        const shape = current.selectionShape
        const rows = lineSpan(view, 'row')
        const cols = lineSpan(view, 'col')
        return [
          {
            type: 'submenu',
            id: 'insert-rows',
            label: ui("Rows"),
            icon: Plus,
            disabled: !canEdit || shape === 'columns' || shape === 'all',
            items: [
              { type: 'item', id: 'insert-rows-above', label: lineLabels.insertBefore(rows), onSelect: () => view.insert('row', 'before') },
              { type: 'item', id: 'insert-rows-below', label: lineLabels.insertAfter(rows), onSelect: () => view.insert('row', 'after') },
            ],
          },
          {
            type: 'submenu',
            id: 'insert-columns',
            label: ui("Columns"),
            disabled: !canEdit || shape === 'rows' || shape === 'all',
            items: [
              { type: 'item', id: 'insert-columns-left', label: lineLabels.insertBefore(cols), onSelect: () => view.insert('col', 'before') },
              { type: 'item', id: 'insert-columns-right', label: lineLabels.insertAfter(cols), onSelect: () => view.insert('col', 'after') },
            ],
          },
          { type: 'item', id: 'insert-sheet', label: ui("Sheet"), icon: Sheet, disabled: !formats, onSelect: () => view.addSheet() },
          separator,
          { type: 'item', id: 'insert-image', label: ui("Image"), icon: ImagePlus, disabled: !formats, onSelect: actions.image },
          functionMenuEntry(view),
          separator,
          { type: 'item', id: 'insert-link', label: ui("Link"), icon: Link2, shortcut: LINK_SHORTCUT, disabled: !formats, onSelect: actions.link },
          { type: 'item', id: 'insert-dropdown', label: ui("Dropdown"), icon: SquareChevronDown, disabled: !formats, onSelect: () => actions.validation('dropdown') },
          separator,
          { type: 'item', id: 'insert-note', label: ui("Note"), icon: MessageSquarePlus, shortcut: NOTE_SHORTCUT, disabled: !formats, onSelect: actions.note },
        ]
      },
    },
    {
      id: 'format',
      label: ui("Format"),
      items: () => {
        const current = view.getState()
        const style = current.activeStyle
        const disabled = current.readOnly || current.valuesOnly
        const align = (hAlign: 'left' | 'center' | 'right') => view.setStyle({ hAlign: style.hAlign === hAlign ? 'general' : hAlign })
        return [
          { type: 'submenu', id: 'format-number', label: ui("Number"), icon: Hash, disabled, items: numberFormatEntries(view, actions.customNumberFormat) },
          {
            type: 'submenu',
            id: 'format-text',
            label: ui("Text"),
            icon: Bold,
            disabled,
            items: [
              { type: 'item', id: 'text-bold', label: ui("Bold"), checked: style.bold, shortcut: { key: 'b', mod: true }, onSelect: () => view.toggleStyle('bold') },
              { type: 'item', id: 'text-italic', label: ui("Italic"), checked: style.italic, shortcut: { key: 'i', mod: true }, onSelect: () => view.toggleStyle('italic') },
              { type: 'item', id: 'text-underline', label: ui("Underline"), checked: !!style.underline, shortcut: { key: 'u', mod: true }, onSelect: () => view.toggleUnderline() },
              { type: 'item', id: 'text-strikethrough', label: ui("Strikethrough"), checked: style.strike, shortcut: { key: '5', mod: true }, onSelect: () => view.toggleStyle('strike') },
            ],
          },
          {
            type: 'submenu',
            id: 'format-alignment',
            label: ui("Alignment"),
            icon: AlignLeft,
            disabled,
            items: [
              { type: 'label', label: ui("Horizontal") },
              { type: 'item', id: 'align-left', label: ui("Left"), radio: true, checked: style.hAlign === 'left', onSelect: () => align('left') },
              { type: 'item', id: 'align-center', label: ui("Center"), radio: true, checked: style.hAlign === 'center', onSelect: () => align('center') },
              { type: 'item', id: 'align-right', label: ui("Right"), radio: true, checked: style.hAlign === 'right', onSelect: () => align('right') },
              separator,
              { type: 'label', label: ui("Vertical") },
              { type: 'item', id: 'align-top', label: ui("Top"), radio: true, checked: style.vAlign === 'top', onSelect: () => view.setStyle({ vAlign: 'top' }) },
              { type: 'item', id: 'align-middle', label: ui("Middle"), radio: true, checked: style.vAlign === 'center', onSelect: () => view.setStyle({ vAlign: 'center' }) },
              { type: 'item', id: 'align-bottom', label: ui("Bottom"), radio: true, checked: style.vAlign === 'bottom', onSelect: () => view.setStyle({ vAlign: 'bottom' }) },
            ],
          },
          {
            type: 'submenu',
            id: 'format-wrapping',
            label: ui("Wrapping"),
            icon: WrapText,
            disabled,
            items: [
              { type: 'item', id: 'wrap-overflow', label: ui("Overflow"), radio: true, checked: !style.wrap, onSelect: () => view.setStyle({ wrap: false }) },
              { type: 'item', id: 'wrap-wrap', label: ui("Wrap"), radio: true, checked: style.wrap, onSelect: () => view.setStyle({ wrap: true }) },
            ],
          },
          {
            type: 'submenu',
            id: 'format-rotation',
            label: ui("Rotation"),
            icon: RotateCw,
            disabled,
            items: ROTATIONS.map((entry): MenuEntry => ({ type: 'item', id: entry.id, label: entry.label(), radio: true, checked: (style.rotation ?? 0) === entry.rotation, onSelect: () => view.setStyle({ rotation: entry.rotation }) })),
          },
          {
            type: 'submenu',
            id: 'format-font-size',
            label: ui("Font size"),
            icon: Type,
            disabled,
            items: FONT_SIZES.map((size): MenuEntry => ({ type: 'item', id: `font-size-${size}`, label: String(size), radio: true, checked: style.fontSize === size, onSelect: () => view.setStyle({ fontSize: size }) })),
          },
          {
            type: 'submenu',
            id: 'format-merge',
            label: ui("Merge cells"),
            icon: TableCellsMerge,
            disabled,
            items: [
              { type: 'item', id: 'merge-all', label: ui("Merge all"), onSelect: () => view.merge('all') },
              { type: 'item', id: 'merge-across', label: ui("Merge horizontally"), onSelect: () => view.merge('across') },
              { type: 'item', id: 'merge-center', label: ui("Merge and center"), onSelect: () => view.merge('center') },
              { type: 'item', id: 'unmerge', label: ui("Unmerge"), onSelect: () => view.unmerge() },
            ],
          },
          separator,
          { type: 'item', id: 'conditional-formatting', label: ui("Conditional formatting…"), icon: Paintbrush, disabled, onSelect: () => actions.conditional() },
          { type: 'item', id: 'alternating-colors', label: ui("Alternating colors"), disabled, onSelect: () => void addAlternatingColors(view) },
          separator,
          { type: 'item', id: 'clear-formatting', label: ui("Clear formatting"), icon: RemoveFormatting, shortcut: CLEAR_FORMATTING_SHORTCUT, disabled, onSelect: () => view.clearFormats() },
        ]
      },
    },
    {
      id: 'data',
      label: ui("Data"),
      items: () => {
        const current = view.getState()
        const disabled = current.readOnly
        const column = columnName(current.selection.active.col)
        // Whole columns or rows have no range to sort: it would reorder one column on its own.
        const sortable = !disabled && (current.selectionShape === 'cells')
        return [
          {
            type: 'submenu',
            id: 'sort-range',
            label: ui("Sort range"),
            icon: ArrowDownAZ,
            disabled: !sortable,
            items: [
              { type: 'item', id: 'sort-range-ascending', label: ui("Sort range by column {{column}} (A to Z)", { column }), onSelect: () => view.sort(false) },
              { type: 'item', id: 'sort-range-descending', label: ui("Sort range by column {{column}} (Z to A)", { column }), onSelect: () => view.sort(true) },
              separator,
              { type: 'item', id: 'sort-range-advanced', label: ui("Advanced range sorting options…"), onSelect: actions.sortRange },
            ],
          },
          separator,
          { type: 'item', id: 'filter', label: current.hasFilter ? ui("Remove filter") : ui("Create a filter"), icon: Funnel, shortcut: FILTER_SHORTCUT, disabled, onSelect: () => view.toggleFilter() },
          { type: 'item', id: 'data-validation', label: ui("Data validation…"), icon: ListChecks, disabled: disabled || current.valuesOnly, onSelect: () => actions.validation() },
        ]
      },
    },
    helpMenu(actions.shortcuts),
  ]
}
