import type { Editor } from '@tiptap/core'

/** The formatting a document toolbar offers, shared by the web toolbar and the mobile one. */
export const FORMAT_COMMANDS = [
  'undo', 'redo',
  'paragraph', 'heading1', 'heading2', 'heading3',
  'bold', 'italic', 'strike', 'code', 'link',
  'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock',
  'table', 'divider',
  'indent', 'outdent',
] as const
export type FormatCommand = typeof FORMAT_COMMANDS[number]

export function isFormatCommand(value: unknown): value is FormatCommand {
  return typeof value === 'string' && (FORMAT_COMMANDS as readonly string[]).includes(value)
}

export interface FormattingState {
  editable: boolean
  canUndo: boolean
  canRedo: boolean
  /** Commands whose mark or block applies at the selection. */
  active: FormatCommand[]
  /** Commands that would do nothing (or fail) at the selection. */
  disabled: FormatCommand[]
  /** The link at the selection, for editing it. */
  linkHref: string | null
}

const ACTIVE_CHECKS: Array<[FormatCommand, (editor: Editor) => boolean]> = [
  ['paragraph', (editor) => editor.isActive('paragraph')],
  ['heading1', (editor) => editor.isActive('heading', { level: 1 })],
  ['heading2', (editor) => editor.isActive('heading', { level: 2 })],
  ['heading3', (editor) => editor.isActive('heading', { level: 3 })],
  ['bold', (editor) => editor.isActive('bold')],
  ['italic', (editor) => editor.isActive('italic')],
  ['strike', (editor) => editor.isActive('strike')],
  ['code', (editor) => editor.isActive('code')],
  ['link', (editor) => editor.isActive('link')],
  ['bulletList', (editor) => editor.isActive('bulletList')],
  ['orderedList', (editor) => editor.isActive('orderedList')],
  ['taskList', (editor) => editor.isActive('taskList')],
  ['blockquote', (editor) => editor.isActive('blockquote')],
  ['codeBlock', (editor) => editor.isActive('codeBlock')],
]

/** The list item type at the selection, for indenting and outdenting. */
function listItemType(editor: Editor): 'listItem' | 'taskItem' | null {
  if (editor.isActive('taskItem')) return 'taskItem'
  if (editor.isActive('listItem')) return 'listItem'
  return null
}

export function formattingState(editor: Editor): FormattingState {
  const editable = editor.isEditable
  const can = editor.can()
  const item = listItemType(editor)
  const disabled: FormatCommand[] = []
  if (!editable) disabled.push(...FORMAT_COMMANDS)
  else {
    if (!can.undo()) disabled.push('undo')
    if (!can.redo()) disabled.push('redo')
    if (!item || !can.sinkListItem(item)) disabled.push('indent')
    if (!item || !can.liftListItem(item)) disabled.push('outdent')
    if (!can.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) disabled.push('table')
  }
  return {
    editable,
    canUndo: editable && !disabled.includes('undo'),
    canRedo: editable && !disabled.includes('redo'),
    active: ACTIVE_CHECKS.filter(([, check]) => check(editor)).map(([command]) => command),
    disabled,
    linkHref: (editor.getAttributes('link').href as string | undefined) ?? null,
  }
}

export function sameFormattingState(left: FormattingState, right: FormattingState): boolean {
  return left.editable === right.editable && left.canUndo === right.canUndo && left.canRedo === right.canRedo
    && left.linkHref === right.linkHref
    && left.active.join() === right.active.join() && left.disabled.join() === right.disabled.join()
}

/**
 * Runs a toolbar command. `link` sets the link to `href` around the selection, or removes it when
 * `href` is empty. Returns whether the editor changed.
 */
export function runFormatCommand(editor: Editor, command: FormatCommand, options: { href?: string; focus?: boolean } = {}): boolean {
  const chain = () => options.focus === false ? editor.chain() : editor.chain().focus()
  const item = listItemType(editor)
  switch (command) {
    case 'undo': return chain().undo().run()
    case 'redo': return chain().redo().run()
    case 'paragraph': return chain().setParagraph().run()
    case 'heading1': return chain().toggleHeading({ level: 1 }).run()
    case 'heading2': return chain().toggleHeading({ level: 2 }).run()
    case 'heading3': return chain().toggleHeading({ level: 3 }).run()
    case 'bold': return chain().toggleBold().run()
    case 'italic': return chain().toggleItalic().run()
    case 'strike': return chain().toggleStrike().run()
    case 'code': return chain().toggleCode().run()
    case 'link': {
      const href = options.href?.trim()
      return href ? chain().extendMarkRange('link').setLink({ href }).run() : chain().extendMarkRange('link').unsetLink().run()
    }
    case 'bulletList': return chain().toggleBulletList().run()
    case 'orderedList': return chain().toggleOrderedList().run()
    case 'taskList': return chain().toggleTaskList().run()
    case 'blockquote': return chain().toggleBlockquote().run()
    case 'codeBlock': return chain().toggleCodeBlock().run()
    case 'table': return chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    case 'divider': return chain().setHorizontalRule().run()
    case 'indent': return item ? chain().sinkListItem(item).run() : false
    case 'outdent': return item ? chain().liftListItem(item).run() : false
  }
}
