import type { EditorBridgeState } from './bridge'
import type { DocxCommand } from './protocol'
import type { NativeToolbarItem } from './textToolbar'

type DocxOption = { command: DocxCommand; label: string; systemImage: string }
/** A button (a command) or a menu (named, with commands as choices). */
type DocxToolbarItem = NativeToolbarItem & { command: DocxCommand | 'textStyle' | 'lists' | 'alignment'; options?: DocxOption[] }

/**
 * The Word editor's bar on phones, laid out like the Markdown editor's: the formatting people
 * reach for while typing, plus comments, suggesting, and the page layout. Everything else stays
 * in the document as it was written.
 */
export const DOCX_TOOLBAR: ReadonlyArray<DocxToolbarItem> = [
  { command: 'undo', label: 'Undo', systemImage: 'arrow.uturn.backward' },
  { command: 'redo', label: 'Redo', systemImage: 'arrow.uturn.forward' },
  { command: 'textStyle', label: 'Text style', systemImage: 'textformat.size', separatorBefore: true, options: [
    { command: 'normal', label: 'Normal text', systemImage: 'text.alignleft' },
    { command: 'heading1', label: 'Heading 1', systemImage: 'textformat.size.larger' },
    { command: 'heading2', label: 'Heading 2', systemImage: 'textformat.size' },
  ] },
  { command: 'bold', label: 'Bold', systemImage: 'bold' },
  { command: 'italic', label: 'Italic', systemImage: 'italic' },
  { command: 'underline', label: 'Underline', systemImage: 'underline' },
  { command: 'strike', label: 'Strikethrough', systemImage: 'strikethrough' },
  { command: 'link', label: 'Link', systemImage: 'link' },
  { command: 'lists', label: 'Lists', systemImage: 'list.bullet', separatorBefore: true, options: [
    { command: 'bulletList', label: 'Bulleted list', systemImage: 'list.bullet' },
    { command: 'numberedList', label: 'Numbered list', systemImage: 'list.number' },
  ] },
  { command: 'outdent', label: 'Outdent', systemImage: 'decrease.indent' },
  { command: 'indent', label: 'Indent', systemImage: 'increase.indent' },
  { command: 'alignment', label: 'Alignment', systemImage: 'text.alignleft', options: [
    { command: 'alignLeft', label: 'Align left', systemImage: 'text.alignleft' },
    { command: 'alignCenter', label: 'Center', systemImage: 'text.aligncenter' },
    { command: 'alignRight', label: 'Align right', systemImage: 'text.alignright' },
  ] },
  { command: 'comment', label: 'Comment', systemImage: 'text.bubble', separatorBefore: true },
  { command: 'suggest', label: 'Suggest changes', systemImage: 'pencil.and.outline' },
  { command: 'layout', label: 'Page layout', systemImage: 'doc.text' },
]

/** Every command the bar can send, menu choices included. */
export function docxToolbarCommands(): DocxCommand[] {
  return DOCX_TOOLBAR.flatMap((item): DocxCommand[] => item.options ? item.options.map((option: DocxOption) => option.command) : [item.command as DocxCommand])
}

/** What a Word editor's toolbar shows as on or unavailable. Defaults (body text, left) are not "on". */
export function docxToolbarState(state: EditorBridgeState): { active: string[]; disabled: string[] } {
  const docx = state.docx
  if (!docx) return { active: [], disabled: [] }
  const active: string[] = []
  if (docx.bold) active.push('bold')
  if (docx.italic) active.push('italic')
  if (docx.underline) active.push('underline')
  if (docx.strike) active.push('strike')
  if (docx.list === 'bullet') active.push('bulletList')
  if (docx.list === 'decimal' || docx.list === 'multilevel') active.push('numberedList')
  if (docx.alignment === 'center') active.push('alignCenter')
  else if (docx.alignment === 'right') active.push('alignRight')
  if (docx.styleId === 'Heading1') active.push('heading1')
  else if (docx.styleId === 'Heading2') active.push('heading2')
  if (docx.link) active.push('link')
  if (docx.suggesting) active.push('suggest')
  if (docx.layout === 'print') active.push('layout')
  return { active, disabled: [...!docx.canUndo ? ['undo'] : [], ...!docx.canRedo ? ['redo'] : [], ...docx.suggesting ? ['link'] : [], ...docx.canComment === false ? ['comment'] : []] }
}
