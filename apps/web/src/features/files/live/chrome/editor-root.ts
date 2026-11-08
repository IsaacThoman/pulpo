import { hasPrimaryModifier } from '../../browser/shortcuts'

/**
 * Marks a live editor's root element (its value names the format). App shortcuts use it to leave
 * editors their keys, and hosts to find the editor in a view. Kept light (it imports only the
 * import-free platform check): the app shell loads it with every page.
 */
export const FILE_EDITOR_ATTRIBUTE = 'data-file-editor'

/** The part of a React keyboard event the root's key tracking reads (React itself is not imported). */
interface RootKeyEvent {
  nativeEvent: Event
  currentTarget: EventTarget
}

/** Each keydown from an editor's React tree, with the root it came through. */
const keyRoots = new WeakMap<Event, EventTarget>()

const trackRootKey = (event: RootKeyEvent) => {
  keyRoots.set(event.nativeEvent, event.currentTarget)
}

/**
 * Spread on an editor's root: `<div {...fileEditorRoot('document')}>`. Besides the marker, it notes
 * keys from the editor's React tree, so its menus and dialogs (body portals, which React still
 * bubbles through the root) count as the editor's (`isKeyFromEditorRoot`).
 */
export function fileEditorRoot(format: string): { 'data-file-editor': string; onKeyDownCapture: (event: RootKeyEvent) => void } {
  return { [FILE_EDITOR_ATTRIBUTE]: format, onKeyDownCapture: trackRootKey } as { 'data-file-editor': string; onKeyDownCapture: (event: RootKeyEvent) => void }
}

/**
 * Whether a keydown came from inside `root` in React's tree: the editor itself, or a menu or dialog
 * it opened in a portal. Fields elsewhere (the chat composer, another view's editor) do not count.
 */
export function isKeyFromEditorRoot(event: Event, root: EventTarget | null): boolean {
  return root !== null && keyRoots.get(event) === root
}

/** Whether an event target is inside a live editor (its toolbar, menus bar, and fields included). */
export function isInFileEditor(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${FILE_EDITOR_ATTRIBUTE}]`) !== null
}

/**
 * Per format, the Cmd/Ctrl combos its keymap formats text with in Word, Docs, Sheets, and Slides:
 * inside those editors they are the document's, even where the editor ignores them (read-only, a
 * cell being typed), so the app's sidebar, agent, settings, and panel keys never fire. Word binds
 * Bold, Justify, Subscript, and Clear formatting; sheets and slides Bold and Clear formatting only
 * (Justify in slides is Cmd/Ctrl+Shift+J), so there Cmd/Ctrl+J asks the agent and Cmd/Ctrl+comma
 * opens settings. Code and notebook editors bind none of them; there they stay the app's, as
 * Cmd/Ctrl+B toggles the sidebar in VS Code and JupyterLab.
 */
const EDITOR_KEYS = new Map<string, ReadonlySet<string>>([
  ['document', new Set(['b', 'j', ',', '\\'])],
  ['sheet', new Set(['b', '\\'])],
  ['presentation', new Set(['b', '\\'])],
])

/**
 * Whether app-level shortcuts should leave this key alone: an editor already handled it, or it is
 * one of its format's combos above. Unlike `isEditableTarget`, the chat composer and other fields
 * keep the app's shortcuts. A combo with the platform's own modifier (Cmd on a Mac, Ctrl
 * elsewhere) that the editor left alone (read-only) is claimed here, so the browser's (Downloads,
 * the bookmarks sidebar, its settings) never runs in its place; Ctrl on a Mac stays the text
 * field's (Ctrl+B moves back a character).
 */
export function editorOwnsKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false
  const editor = event.target instanceof Element ? event.target.closest(`[${FILE_EDITOR_ATTRIBUTE}]`) : null
  if (!EDITOR_KEYS.get(editor?.getAttribute(FILE_EDITOR_ATTRIBUTE) ?? '')?.has(event.key.toLowerCase())) return false
  if (hasPrimaryModifier(event) && !(event.metaKey && event.ctrlKey)) event.preventDefault()
  return true
}
