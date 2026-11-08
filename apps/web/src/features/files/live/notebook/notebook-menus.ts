import type { NotebookCellType } from '@pulpo/client-core/office/notebook'
import type { NotebookCellState, NotebookController } from '@pulpo/client-core/office/notebook/view'
import {
  ArrowDown,
  ArrowUp,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  ChevronsDownUp,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eraser,
  Heading,
  Merge,
  Play,
  Scissors,
  SplitSquareVertical,
  Trash2,
} from 'lucide-react'
import { ui } from '@/i18n/ui'
import { separator, type MenuDefinition, type MenuEntry } from '../chrome/menu'
import type { ShortcutSpec } from '../chrome/shortcuts'
import { findEntries, undoRedoEntries } from '../chrome/standard-menus'

/**
 * The notebook editor's menus, as JupyterLab and Colab lay theirs out (Edit, View, Insert, Cell,
 * and Runtime when an agent can run it), the toolbar's View options, and a cell's context menu:
 * data for the shared menu bar. Each builder reads the controller's state when its menu opens.
 */

/** What the menus need beyond the controller's own commands: the view's state and the editor's helpers. */
export interface NotebookMenuContext {
  controller: NotebookController
  /** Whether this person may change the notebook. */
  editable: boolean
  /** Copy and cut the selected cells, also as text on the system clipboard. */
  copy: () => void
  cut: () => void
  find: (mode: 'find' | 'replace') => void
  outline: boolean
  toggleOutline: () => void
  lineNumbers: boolean
  setLineNumbers: (on: boolean) => void
  wrap: boolean
  setWrap: (on: boolean) => void
  /** Whether the selected cells' long outputs scroll (rather than show in full), and the toggle (Shift+O). */
  outputsScroll: () => boolean
  toggleOutputScroll: () => void
  /** Hidden code (`source`) or outputs a viewer opened for themselves, and opening them. */
  revealed: (key: string, part: 'source' | 'outputs') => boolean
  reveal: (keys: readonly string[], part: 'source' | 'outputs') => void
  /** Inserts a Markdown cell below with a heading of this level, ready to type its text. */
  insertHeading: (level: number) => void
  /** Copies a cell's outputs as plain text. */
  copyOutputText: (key: string) => void
  runWithAgent?: () => void
}

const key = (name: string, more: Omit<ShortcutSpec, 'key'> = {}): ShortcutSpec => ({ key: name, ...more })

export function typeLabel(type: NotebookCellType): string {
  return type === 'code' ? ui("Code") : type === 'markdown' ? ui("Markdown") : ui("Raw")
}

/** Insert ▸ Heading's levels, as Docs and Word name them. */
function headingLabel(level: number): string {
  switch (level) {
    case 1: return ui("Heading 1")
    case 2: return ui("Heading 2")
    case 3: return ui("Heading 3")
    case 4: return ui("Heading 4")
    case 5: return ui("Heading 5")
    default: return ui("Heading 6")
  }
}

export function hasOutputs(cell: NotebookCellState | undefined): boolean {
  return cell?.type === 'code' && Boolean(cell.outputs && cell.outputs.json !== '[]')
}

/** The state a menu acts on: the selection, and whether this person can change the notebook. */
function current(context: NotebookMenuContext) {
  const state = context.controller.getState()
  const can = context.editable && !state.readOnly
  const selected = state.cells.filter((cell) => state.selected.includes(cell.key))
  const active = state.cells.find((cell) => cell.key === state.active)
  return { state, can, selected, active }
}

type Current = ReturnType<typeof current>

/** Hide or show the selected cells' code and outputs; viewers open hidden ones for themselves only. */
function hiddenEntries(context: NotebookMenuContext, { selected, can }: Current): MenuEntry[] {
  const { controller } = context
  const withOutputs = selected.filter(hasOutputs)
  if (!can) {
    const source = selected.filter((cell) => cell.sourceCollapsed && !context.revealed(cell.key, 'source'))
    const outputs = withOutputs.filter((cell) => cell.outputsCollapsed && !context.revealed(cell.key, 'outputs'))
    return [
      ...source.length ? [{ type: 'item', id: 'toggle-code', label: ui("Show code"), onSelect: () => context.reveal(source.map((cell) => cell.key), 'source') } satisfies MenuEntry] : [],
      ...outputs.length ? [{ type: 'item', id: 'toggle-outputs', label: ui("Show outputs"), onSelect: () => context.reveal(outputs.map((cell) => cell.key), 'outputs') } satisfies MenuEntry] : [],
    ]
  }
  if (!selected.length) return []
  const codeHidden = selected.every((cell) => cell.sourceCollapsed)
  const outputsHidden = withOutputs.length > 0 && withOutputs.every((cell) => cell.outputsCollapsed)
  return [
    { type: 'item', id: 'toggle-code', label: codeHidden ? ui("Show code") : ui("Hide code"), onSelect: () => controller.toggleSource() },
    ...withOutputs.length ? [{ type: 'item', id: 'toggle-outputs', label: outputsHidden ? ui("Show outputs") : ui("Hide outputs"), shortcut: key('o'), onSelect: () => controller.toggleOutputs() } satisfies MenuEntry] : [],
  ]
}

/** Cut, copy, and paste cells, with Jupyter's command-mode letters. */
function clipboardEntries(context: NotebookMenuContext, { state, can }: Current): MenuEntry[] {
  const { controller } = context
  return [
    { type: 'item', id: 'cut-cells', label: ui("Cut cells"), icon: Scissors, shortcut: key('x'), disabled: !can || !state.active, onSelect: context.cut },
    { type: 'item', id: 'copy-cells', label: ui("Copy cells"), icon: Copy, shortcut: key('c'), disabled: !state.active, onSelect: context.copy },
    { type: 'item', id: 'paste-cells', label: ui("Paste cells below"), icon: ClipboardPaste, shortcut: key('v'), disabled: !can || !state.canPaste, onSelect: () => void controller.paste('below') },
    { type: 'item', id: 'paste-cells-above', label: ui("Paste cells above"), shortcut: key('v', { shift: true }), disabled: !can || !state.canPaste, onSelect: () => void controller.paste('above') },
  ]
}

/** Cell type ▸ Code, Markdown, Raw (Y, M, R), the active cell's checked. */
function typeEntry({ controller }: NotebookMenuContext, { can, active }: Current): MenuEntry {
  return {
    type: 'submenu',
    id: 'cell-type',
    label: ui("Cell type"),
    disabled: !can || !active,
    items: (['code', 'markdown', 'raw'] as const).map((type): MenuEntry => ({
      type: 'item',
      id: `type-${type}`,
      label: typeLabel(type),
      radio: true,
      checked: active?.type === type,
      shortcut: key(type === 'code' ? 'y' : type === 'markdown' ? 'm' : 'r'),
      onSelect: () => controller.setType(type),
    })),
  }
}

function moveEntries({ controller }: NotebookMenuContext, { can, state }: Current): MenuEntry[] {
  return [
    { type: 'item', id: 'move-up', label: ui("Move cell up"), icon: ArrowUp, shortcut: key('ArrowUp', { alt: true }), disabled: !can || !state.active, onSelect: () => controller.move('up') },
    { type: 'item', id: 'move-down', label: ui("Move cell down"), icon: ArrowDown, shortcut: key('ArrowDown', { alt: true }), disabled: !can || !state.active, onSelect: () => controller.move('down') },
  ]
}

function splitMergeEntries({ controller }: NotebookMenuContext, { can, state }: Current): MenuEntry[] {
  const index = state.cells.findIndex((cell) => cell.key === state.active)
  return [
    { type: 'item', id: 'split', label: ui("Split cell at the cursor"), icon: SplitSquareVertical, shortcut: key('-', { mod: true, shift: true }), disabled: !can || state.mode !== 'edit', onSelect: () => controller.split() },
    { type: 'item', id: 'merge-selected', label: ui("Merge selected cells"), icon: Merge, shortcut: key('m', { shift: true }), disabled: !can || state.selected.length < 2, onSelect: () => controller.merge() },
    {
      type: 'item',
      id: 'merge-below',
      label: ui("Merge with the cell below"),
      disabled: !can || index < 0 || index === state.cells.length - 1,
      onSelect: () => {
        // Merge takes the cell below only with one cell selected: keep just the active one.
        const { active } = controller.getState()
        if (active) controller.select(active)
        controller.merge()
      },
    },
  ]
}

/** Code and Markdown cells above or below; the new cell is ready to type in. */
function insertEntries({ controller }: NotebookMenuContext, can: boolean, labels: 'menu' | 'context'): MenuEntry[] {
  const menu = labels === 'menu'
  const insert = (where: 'above' | 'below', type: NotebookCellType) => () => { controller.insert(where, type, { edit: true }) }
  return [
    { type: 'item', id: 'insert-code-above', label: menu ? ui("Code cell above") : ui("Insert code cell above"), icon: BetweenHorizontalStart, shortcut: key('a'), disabled: !can, onSelect: insert('above', 'code') },
    { type: 'item', id: 'insert-code-below', label: menu ? ui("Code cell below") : ui("Insert code cell below"), icon: BetweenHorizontalEnd, shortcut: key('b'), disabled: !can, onSelect: insert('below', 'code') },
    { type: 'item', id: 'insert-markdown-above', label: menu ? ui("Markdown cell above") : ui("Insert Markdown cell above"), disabled: !can, onSelect: insert('above', 'markdown') },
    { type: 'item', id: 'insert-markdown-below', label: menu ? ui("Markdown cell below") : ui("Insert Markdown cell below"), disabled: !can, onSelect: insert('below', 'markdown') },
  ]
}

function duplicateEntry({ controller }: NotebookMenuContext, { can, state }: Current): MenuEntry {
  return { type: 'item', id: 'duplicate', label: ui("Duplicate cell"), icon: CopyPlus, shortcut: key('ArrowDown', { shift: true, alt: true }), disabled: !can || !state.active, onSelect: () => controller.duplicate() }
}

function deleteEntry({ controller }: NotebookMenuContext, { can, state }: Current): MenuEntry {
  return {
    type: 'item',
    id: 'delete-cells',
    label: state.selected.length > 1 ? ui("Delete cells") : ui("Delete cell"),
    icon: Trash2,
    destructive: true,
    disabled: !can || !state.active,
    onSelect: () => controller.deleteSelected(),
  }
}

/** Collapsing or expanding every code cell's code or outputs (the notebook's, one undo step each). */
function collapseEntries({ controller }: NotebookMenuContext, can: boolean): MenuEntry[] {
  return [
    { type: 'item', id: 'collapse-code', label: ui("Collapse all code"), disabled: !can, onSelect: () => controller.setAllCollapsed('source', true) },
    { type: 'item', id: 'expand-code', label: ui("Expand all code"), disabled: !can, onSelect: () => controller.setAllCollapsed('source', false) },
    { type: 'item', id: 'collapse-outputs', label: ui("Collapse all outputs"), disabled: !can, onSelect: () => controller.setAllCollapsed('outputs', true) },
    { type: 'item', id: 'expand-outputs', label: ui("Expand all outputs"), disabled: !can, onSelect: () => controller.setAllCollapsed('outputs', false) },
  ]
}

/** Line numbers and wrapping: how this person reads the cells. */
function readingEntries(context: NotebookMenuContext): MenuEntry[] {
  return [
    { type: 'item', id: 'line-numbers', label: ui("Line numbers"), checked: context.lineNumbers, shortcut: key('l', { shift: true }), onSelect: () => context.setLineNumbers(!context.lineNumbers) },
    { type: 'item', id: 'wrap', label: ui("Wrap long lines"), checked: context.wrap, onSelect: () => context.setWrap(!context.wrap) },
  ]
}

/** The toolbar's View options: line numbers and wrapping, then collapsing or expanding every cell. */
export function viewOptionEntries(context: NotebookMenuContext): MenuEntry[] {
  return [...readingEntries(context), separator, ...collapseEntries(context, current(context).can)]
}

/** Edit, View, Insert, Cell, and Runtime (with an agent to run the notebook), between the host's File and Help. */
export function notebookMenus(context: NotebookMenuContext): MenuDefinition[] {
  const { controller } = context
  return [
    {
      id: 'edit',
      label: ui("Edit"),
      items: () => {
        const now = current(context)
        const { state, can } = now
        return [
          ...undoRedoEntries({ undo: () => controller.undo(), redo: () => controller.redo(), canUndo: can && state.canUndo, canRedo: can && state.canRedo }),
          separator,
          ...clipboardEntries(context, now),
          { ...deleteEntry(context, now), destructive: false },
          separator,
          { type: 'item', id: 'select-all-cells', label: ui("Select every cell"), shortcut: key('a', { mod: true }), disabled: !state.cells.length, onSelect: () => controller.selectAll() },
          separator,
          ...findEntries({ find: () => context.find('find'), replace: () => context.find('replace') }),
          separator,
          { type: 'item', id: 'clear-outputs', label: ui("Clear outputs of selected cells"), icon: Eraser, disabled: !can || !state.active, onSelect: () => controller.clearOutputs('selected') },
          { type: 'item', id: 'clear-all-outputs', label: ui("Clear all outputs"), disabled: !can, onSelect: () => controller.clearOutputs('all') },
        ]
      },
    },
    {
      id: 'view',
      label: ui("View"),
      items: () => {
        const now = current(context)
        return [
          { type: 'item', id: 'outline', label: ui("Table of contents"), checked: context.outline, onSelect: context.toggleOutline },
          separator,
          ...readingEntries(context),
          { type: 'item', id: 'output-scroll', label: ui("Scroll long outputs"), checked: Boolean(now.state.active) && context.outputsScroll(), shortcut: key('o', { shift: true }), disabled: !now.selected.some(hasOutputs), onSelect: context.toggleOutputScroll },
          separator,
          { type: 'submenu', id: 'collapse', label: ui("Collapse and expand"), icon: ChevronsDownUp, disabled: !now.can, items: collapseEntries(context, now.can) },
          ...hiddenEntries(context, now),
        ]
      },
    },
    {
      id: 'insert',
      label: ui("Insert"),
      items: () => {
        const now = current(context)
        return [
          ...insertEntries(context, now.can, 'menu'),
          separator,
          {
            type: 'submenu',
            id: 'heading',
            label: ui("Heading"),
            icon: Heading,
            disabled: !now.can,
            items: [1, 2, 3, 4, 5, 6].map((level): MenuEntry => ({ type: 'item', id: `heading-${level}`, label: headingLabel(level), onSelect: () => context.insertHeading(level) })),
          },
          separator,
          duplicateEntry(context, now),
        ]
      },
    },
    {
      id: 'cell',
      label: ui("Cell"),
      items: () => {
        const now = current(context)
        return [
          typeEntry(context, now),
          separator,
          ...moveEntries(context, now),
          separator,
          ...splitMergeEntries(context, now),
          separator,
          ...hiddenEntries(context, now),
          separator,
          deleteEntry(context, now),
        ]
      },
    },
    ...context.runWithAgent ? [{
      id: 'runtime',
      label: ui("Runtime"),
      items: () => [{ type: 'item', id: 'run-with-agent', label: ui("Run all with agent"), icon: Play, onSelect: context.runWithAgent! } satisfies MenuEntry],
    } satisfies MenuDefinition] : [],
  ]
}

/**
 * A cell's context menu (right-click on its prompt, frame, rendered Markdown, or outputs), with
 * what JupyterLab's and VS Code's offer. The view selects the cell first (unless it is part of the
 * selection), so commands act on it, or on the selection it belongs to.
 */
export function cellContextEntries(context: NotebookMenuContext, cellKey: string): MenuEntry[] {
  const now = current(context)
  const cell = now.state.cells.find((entry) => entry.key === cellKey)
  if (!cell) return []
  return [
    ...clipboardEntries(context, now),
    separator,
    ...insertEntries(context, now.can, 'context'),
    duplicateEntry(context, now),
    separator,
    ...moveEntries(context, now),
    typeEntry(context, now),
    ...splitMergeEntries(context, now),
    separator,
    ...hiddenEntries(context, now),
    ...hasOutputs(cell) ? [
      { type: 'item', id: 'clear-outputs', label: ui("Clear outputs"), icon: Eraser, disabled: !now.can, onSelect: () => context.controller.clearOutputs('selected') } satisfies MenuEntry,
      { type: 'item', id: 'copy-output-text', label: ui("Copy output text"), icon: ClipboardCopy, onSelect: () => context.copyOutputText(cellKey) } satisfies MenuEntry,
    ] : [],
    separator,
    deleteEntry(context, now),
  ]
}
