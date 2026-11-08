/**
 * Marks a live editor's root element (its value names the format). App shortcuts use it to leave
 * editors their keys, and hosts to find the editor in a view. Kept free of imports: the app shell
 * loads it with every page.
 */
export const FILE_EDITOR_ATTRIBUTE = 'data-file-editor'

/** Spread on an editor's root: `<div {...fileEditorRoot('document')}>`. */
export function fileEditorRoot(format: string): { 'data-file-editor': string } {
  return { [FILE_EDITOR_ATTRIBUTE]: format } as { 'data-file-editor': string }
}

/** Whether an event target is inside a live editor (its toolbar, menus bar, and fields included). */
export function isInFileEditor(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${FILE_EDITOR_ATTRIBUTE}]`) !== null
}

/**
 * Cmd/Ctrl combos that format text in Word, Docs, Sheets, and Slides (Bold, Justify, Subscript,
 * Clear formatting): inside those editors they are the document's, even where the editor ignores
 * them (read-only, a cell being typed), so the app's sidebar, agent, settings, and panel keys never
 * fire. Code and notebook editors bind none of them; there they stay the app's, as Cmd/Ctrl+B
 * toggles the sidebar in VS Code and JupyterLab.
 */
const EDITOR_KEYS = new Set(['b', 'j', ',', '\\'])
const FORMATTING_EDITORS = new Set(['document', 'sheet', 'presentation'])

/**
 * Whether app-level shortcuts should leave this key alone: an editor already handled it, or it is
 * one of the formatting combos above pressed inside an Office editor. Unlike `isEditableTarget`,
 * the chat composer and other fields keep the app's shortcuts.
 */
export function editorOwnsKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true
  if (!(event.metaKey || event.ctrlKey) || event.altKey || !EDITOR_KEYS.has(event.key.toLowerCase())) return false
  const editor = event.target instanceof Element ? event.target.closest(`[${FILE_EDITOR_ATTRIBUTE}]`) : null
  return FORMATTING_EDITORS.has(editor?.getAttribute(FILE_EDITOR_ATTRIBUTE) ?? '')
}
