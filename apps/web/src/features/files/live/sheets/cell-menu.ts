import { ArrowDownAZ, EyeOff, Funnel, Link2, ListChecks, MessageSquarePlus, Paintbrush, Plus, Trash2 } from 'lucide-react'
import type { SheetView } from '@pulpo/client-core/office/sheets/view'
import { ui } from '@/i18n/ui'
import { separator, type MenuEntry } from '../chrome/menu'
import { CLEAR_SHORTCUT, clipboardEntries, LINK_SHORTCUT, NOTE_SHORTCUT, type SheetMenuActions } from './sheet-menus'
import { hasHiddenLines, lineLabels, lineSpan } from './selection-labels'

/**
 * The grid's right-click menu, as Google Sheets lays it out: the clipboard, then inserting and
 * deleting the selected lines with their counts ("Insert 3 rows above", "Delete columns B–D"),
 * then clearing, sorting and filtering, links and notes, and the rule dialogs. Whole rows or
 * whole columns get only their own commands, with Hide, Unhide and Resize. CSV files keep values
 * only, so they get no format, note, link or size items.
 */
export function cellMenuEntries(view: SheetView, actions: SheetMenuActions): MenuEntry[] {
  const state = view.getState()
  const canEdit = !state.readOnly
  const formats = canEdit && !state.valuesOnly
  const shape = state.selectionShape
  const rows = shape === 'cells' || shape === 'rows'
  const cols = shape === 'cells' || shape === 'columns'
  const rowSpan = lineSpan(view, 'row')
  const colSpan = lineSpan(view, 'col')
  const lineKind = shape === 'rows' ? 'row' : shape === 'columns' ? 'col' : undefined
  const ranges = view.selection.ranges
  const last = ranges[ranges.length - 1]!
  const multiCell = ranges.length === 1 && (last.top !== last.bottom || last.left !== last.right)
  const lineItems = (kind: 'row' | 'col'): MenuEntry[] => {
    const span = kind === 'row' ? rowSpan : colSpan
    return [
      { type: 'item', id: `hide-${kind}s`, label: lineLabels.hide(span), icon: EyeOff, disabled: !formats, onSelect: () => view.hideLines(kind, true) },
      { type: 'item', id: `unhide-${kind}s`, label: lineLabels.unhide(span), disabled: !formats || !hasHiddenLines(view, kind), onSelect: () => view.hideLines(kind, false) },
      { type: 'item', id: `resize-${kind}s`, label: lineLabels.resize(span), disabled: !formats, onSelect: () => actions.resize(kind) },
      { type: 'item', id: `fit-${kind}s`, label: ui("Fit to data"), disabled: !formats, onSelect: () => view.autoFit(kind) },
    ]
  }
  return [
    ...clipboardEntries(view, actions),
    separator,
    ...(shape !== 'all' && rows ? [
      { type: 'item', id: 'insert-rows-above', label: lineLabels.insertBefore(rowSpan), icon: Plus, disabled: !canEdit, onSelect: () => view.insert('row', 'before') },
      { type: 'item', id: 'insert-rows-below', label: lineLabels.insertAfter(rowSpan), disabled: !canEdit, onSelect: () => view.insert('row', 'after') },
    ] satisfies MenuEntry[] : []),
    ...(shape !== 'all' && cols ? [
      { type: 'item', id: 'insert-columns-left', label: lineLabels.insertBefore(colSpan), icon: rows ? undefined : Plus, disabled: !canEdit, onSelect: () => view.insert('col', 'before') },
      { type: 'item', id: 'insert-columns-right', label: lineLabels.insertAfter(colSpan), disabled: !canEdit, onSelect: () => view.insert('col', 'after') },
    ] satisfies MenuEntry[] : []),
    ...(shape !== 'all' && rows ? [{ type: 'item', id: 'delete-rows', label: lineLabels.delete(rowSpan), icon: Trash2, disabled: !canEdit, onSelect: () => view.deleteLines('row') } satisfies MenuEntry] : []),
    ...(shape !== 'all' && cols ? [{ type: 'item', id: 'delete-columns', label: lineLabels.delete(colSpan), icon: rows ? undefined : Trash2, disabled: !canEdit, onSelect: () => view.deleteLines('col') } satisfies MenuEntry] : []),
    separator,
    { type: 'item', id: 'clear-contents', label: ui("Clear contents"), shortcut: CLEAR_SHORTCUT, disabled: !canEdit, onSelect: () => view.clearContents() },
    ...(lineKind && !state.valuesOnly ? [separator, ...lineItems(lineKind)] : []),
    separator,
    ...(shape === 'cells' && multiCell ? [{
      type: 'submenu',
      id: 'sort-range',
      label: ui("Sort range"),
      icon: ArrowDownAZ,
      disabled: !canEdit,
      items: [
        { type: 'item', id: 'sort-range-ascending', label: ui("Sort A to Z"), onSelect: () => view.sort(false) },
        { type: 'item', id: 'sort-range-descending', label: ui("Sort Z to A"), onSelect: () => view.sort(true) },
        separator,
        { type: 'item', id: 'sort-range-advanced', label: ui("Advanced range sorting options…"), onSelect: actions.sortRange },
      ],
    } satisfies MenuEntry] : []),
    ...(shape !== 'all' ? [{ type: 'item', id: 'filter', label: state.hasFilter ? ui("Remove filter") : ui("Create a filter"), icon: Funnel, disabled: !canEdit, onSelect: () => view.toggleFilter() } satisfies MenuEntry] : []),
    ...(state.valuesOnly ? [] : [
      separator,
      // Links and notes belong to cells, not to whole rows or columns.
      ...(shape === 'cells' ? [
        { type: 'item', id: 'insert-link', label: state.activeLink ? ui("Edit link") : ui("Insert link"), icon: Link2, shortcut: LINK_SHORTCUT, disabled: !formats, onSelect: actions.link },
        ...(state.activeLink ? [{ type: 'item', id: 'remove-link', label: ui("Remove link"), disabled: !formats, onSelect: () => view.setLink(undefined) } satisfies MenuEntry] : []),
        { type: 'item', id: 'insert-note', label: state.activeNote ? ui("Edit note") : ui("Insert note"), icon: MessageSquarePlus, shortcut: NOTE_SHORTCUT, disabled: !formats, onSelect: actions.note },
        ...(state.activeNote ? [{ type: 'item', id: 'delete-note', label: ui("Delete note"), disabled: !formats, onSelect: () => view.setNote(undefined) } satisfies MenuEntry] : []),
        separator,
      ] satisfies MenuEntry[] : []),
      { type: 'item', id: 'conditional-formatting', label: ui("Conditional formatting…"), icon: Paintbrush, disabled: !formats, onSelect: () => actions.conditional() },
      { type: 'item', id: 'data-validation', label: ui("Data validation…"), icon: ListChecks, disabled: !formats, onSelect: () => actions.validation() },
    ] satisfies MenuEntry[]),
  ]
}
