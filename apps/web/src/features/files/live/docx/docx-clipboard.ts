import { AllSelection } from '@tiptap/pm/state'
import type { DocxEditor } from '@pulpo/client-core/office/docx/view'
import { ui } from '@/i18n/ui'
import { useFileToasts } from '../../browser/toasts'
import { formatShortcut } from '../chrome/shortcuts'

export interface ClipboardData {
  html?: string
  text?: string
  files: Blob[]
}

/**
 * What the system clipboard holds, read through the async Clipboard API (a menu's Paste has no
 * paste event): HTML, text, and pictures. Null when the browser refuses (no permission, or no
 * API), so the caller can point at the keyboard instead.
 */
export async function readClipboard(): Promise<ClipboardData | null> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (!clipboard) return null
  if (typeof clipboard.read === 'function') {
    try {
      const data: ClipboardData = { files: [] }
      for (const item of await clipboard.read()) {
        for (const type of item.types) {
          if (type === 'text/html' && data.html === undefined) data.html = await (await item.getType(type)).text()
          else if (type === 'text/plain' && data.text === undefined) data.text = await (await item.getType(type)).text()
          else if (type.startsWith('image/')) data.files.push(await item.getType(type))
        }
      }
      return data
    } catch {
      // Firefox and older Safari read text only; a refused permission lands here too.
    }
  }
  if (typeof clipboard.readText !== 'function') return null
  try {
    return { text: await clipboard.readText(), files: [] }
  } catch {
    return null
  }
}

/** Docs' answer when the browser keeps the clipboard from the page: the keys still work. */
export function showPasteHint(): void {
  useFileToasts.getState().show({ message: ui("Use {{shortcut}} to paste", { shortcut: formatShortcut({ key: 'v', mod: true }) }) })
}

/** Paste (or Paste without formatting) from a menu, through the editor's own paste path. */
export async function pasteFromClipboard(editor: DocxEditor, plain = false): Promise<boolean> {
  const data = await readClipboard()
  if (!data) {
    showPasteHint()
    return false
  }
  return editor.pasteData(data, { plain })
}

/**
 * Cut or Copy from a menu: the document takes focus back first, so the editor's own copy handler
 * (exact Pulpo copies, pictures) runs as it does for Cmd/Ctrl+C. The menus around it must not
 * trap focus (modal={false}).
 */
export function copyFromMenu(editor: DocxEditor, cut: boolean): boolean {
  editor.focus()
  try {
    return document.execCommand(cut ? 'cut' : 'copy')
  } catch {
    return false
  }
}

/** Edit ▸ Select all, in the body or the open header, footer, or note. */
export function selectAll(editor: DocxEditor): void {
  if (editor.run((state) => state.tr.setSelection(new AllSelection(state.doc)))) return
  // A read-only document runs no commands, but its text can still be selected, to copy. (The
  // browser's own Select all would take the whole page: menus, toolbar, and panels.)
  const { view } = editor
  view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
  const selection = document.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(view.dom)
  selection.removeAllRanges()
  selection.addRange(range)
}
