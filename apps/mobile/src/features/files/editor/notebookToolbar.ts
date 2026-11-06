import type { EditorBridgeState } from './bridge'
import type { NotebookCommand } from './protocol'
import type { NativeToolbarItem } from './textToolbar'

/**
 * The notebook editor's bar above the keyboard: undo and redo, the indent keys a phone lacks, and
 * the cell actions people reach for while typing. Moving and deleting cells also sit on the active
 * cell itself, so they work without the keyboard.
 */
export const NOTEBOOK_TOOLBAR: ReadonlyArray<NativeToolbarItem & { command: NotebookCommand }> = [
  { command: 'undo', label: 'Undo', systemImage: 'arrow.uturn.backward' },
  { command: 'redo', label: 'Redo', systemImage: 'arrow.uturn.forward' },
  { command: 'indentLess', label: 'Outdent', systemImage: 'decrease.indent' },
  { command: 'indentMore', label: 'Indent', systemImage: 'increase.indent' },
  { command: 'insertBelow', label: 'Insert cell below', systemImage: 'plus' },
  { command: 'toggleType', label: 'Code or Markdown', systemImage: 'chevron.left.forwardslash.chevron.right' },
  { command: 'moveUp', label: 'Move cell up', systemImage: 'arrow.up' },
  { command: 'moveDown', label: 'Move cell down', systemImage: 'arrow.down' },
  { command: 'toggleOutputs', label: 'Hide or show outputs', systemImage: 'eye.slash' },
]

/** What the notebook bar shows as on or unavailable. */
export function notebookToolbarState(state: EditorBridgeState): { active: string[]; disabled: string[] } {
  const notebook = state.notebook
  return {
    active: [...notebook?.cellType === 'code' ? ['toggleType'] : [], ...notebook?.outputsCollapsed ? ['toggleOutputs'] : []],
    disabled: [
      ...!notebook?.canUndo ? ['undo'] : [],
      ...!notebook?.canRedo ? ['redo'] : [],
      ...notebook?.cellType !== 'code' ? ['toggleOutputs'] : [],
      ...!notebook?.cellType ? ['toggleType', 'moveUp', 'moveDown'] : [],
    ],
  }
}
