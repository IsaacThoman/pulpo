import type { EditorBridgeState } from './bridge'
import type { TextCommand } from './protocol'

/** A choice in a toolbar menu (SF Symbol name). */
export type NativeToolbarOption = { command: string; label: string; systemImage: string }

/**
 * A toolbar button the native bar shows for formats with their own toolbar (SF Symbol name). With
 * `options` it opens a menu of them instead, and `command` only names the menu.
 */
export type NativeToolbarItem = { command: string; label: string; systemImage: string; options?: readonly NativeToolbarOption[] }

/** The text and code editor's bar: no formatting, but the keys a phone keyboard lacks. */
export const TEXT_TOOLBAR: ReadonlyArray<NativeToolbarItem & { command: TextCommand }> = [
  { command: 'undo', label: 'Undo', systemImage: 'arrow.uturn.backward' },
  { command: 'redo', label: 'Redo', systemImage: 'arrow.uturn.forward' },
  { command: 'indentLess', label: 'Outdent', systemImage: 'decrease.indent' },
  { command: 'indentMore', label: 'Indent', systemImage: 'increase.indent' },
  { command: 'find', label: 'Find and replace', systemImage: 'magnifyingglass' },
  { command: 'wrap', label: 'Wrap lines', systemImage: 'arrow.turn.down.left' },
]

/** What a text editor's toolbar shows as on or unavailable. */
export function textToolbarState(state: EditorBridgeState): { active: string[]; disabled: string[] } {
  const text = state.text
  return {
    active: text?.wrap ? ['wrap'] : [],
    disabled: [...!text?.canUndo ? ['undo'] : [], ...!text?.canRedo ? ['redo'] : []],
  }
}
