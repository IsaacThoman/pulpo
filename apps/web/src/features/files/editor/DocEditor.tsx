import { useEffect, type ReactNode } from 'react'
import { createDocExtensions } from '@pulpo/client-core/doc-schema'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Table,
  Undo2,
} from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { sessionColor, sessionLabel } from './presence'
import type { DocSession } from './use-doc-session'
import './doc-editor.css'

function ToolbarButton({ label, active, disabled, onClick, children }: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-accent text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function DocToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      editable: current.isEditable,
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      link: current.isActive('link'),
      h1: current.isActive('heading', { level: 1 }),
      h2: current.isActive('heading', { level: 2 }),
      h3: current.isActive('heading', { level: 3 }),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      taskList: current.isActive('taskList'),
      blockquote: current.isActive('blockquote'),
      codeBlock: current.isActive('codeBlock'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  })
  const chain = () => editor.chain().focus()
  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    const href = window.prompt(ui("Link URL"), previous ?? 'https://')
    if (href === null) return
    if (!href.trim()) chain().extendMarkRange('link').unsetLink().run()
    else chain().extendMarkRange('link').setLink({ href: href.trim() }).run()
  }
  const disabled = !state.editable
  return (
    <div role="toolbar" aria-label={ui("Formatting")} className="flex flex-wrap items-center gap-0.5">
      <ToolbarButton label={ui("Undo")} disabled={disabled || !state.canUndo} onClick={() => chain().undo().run()}><Undo2 className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Redo")} disabled={disabled || !state.canRedo} onClick={() => chain().redo().run()}><Redo2 className="size-4" /></ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton label={ui("Heading 1")} active={state.h1} disabled={disabled} onClick={() => chain().toggleHeading({ level: 1 }).run()}><Heading1 className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Heading 2")} active={state.h2} disabled={disabled} onClick={() => chain().toggleHeading({ level: 2 }).run()}><Heading2 className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Heading 3")} active={state.h3} disabled={disabled} onClick={() => chain().toggleHeading({ level: 3 }).run()}><Heading3 className="size-4" /></ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton label={ui("Bold")} active={state.bold} disabled={disabled} onClick={() => chain().toggleBold().run()}><Bold className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Italic")} active={state.italic} disabled={disabled} onClick={() => chain().toggleItalic().run()}><Italic className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Strikethrough")} active={state.strike} disabled={disabled} onClick={() => chain().toggleStrike().run()}><Strikethrough className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Inline code")} active={state.code} disabled={disabled} onClick={() => chain().toggleCode().run()}><Code className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Link")} active={state.link} disabled={disabled} onClick={setLink}><Link2 className="size-4" /></ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton label={ui("Bulleted list")} active={state.bulletList} disabled={disabled} onClick={() => chain().toggleBulletList().run()}><List className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Numbered list")} active={state.orderedList} disabled={disabled} onClick={() => chain().toggleOrderedList().run()}><ListOrdered className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Checklist")} active={state.taskList} disabled={disabled} onClick={() => chain().toggleTaskList().run()}><ListChecks className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Quote")} active={state.blockquote} disabled={disabled} onClick={() => chain().toggleBlockquote().run()}><Quote className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Code block")} active={state.codeBlock} disabled={disabled} onClick={() => chain().toggleCodeBlock().run()}><SquareCode className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Table")} disabled={disabled} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Divider")} disabled={disabled} onClick={() => chain().setHorizontalRule().run()}><Minus className="size-4" /></ToolbarButton>
    </div>
  )
}

export function DocEditor({ session, editable, toolbarSlot }: {
  session: DocSession
  editable: boolean
  /** Rendered next to the toolbar, e.g. presence and sync status. */
  toolbarSlot?: ReactNode
}) {
  const editor = useEditor({
    extensions: [
      ...createDocExtensions(),
      Placeholder.configure({ placeholder: ui("Start writing…") }),
      Collaboration.configure({ document: session.doc }),
      CollaborationCaret.configure({
        provider: session.provider,
        user: { name: sessionLabel(), color: sessionColor(session.doc.clientID) },
      }),
    ],
    editable,
    editorProps: {
      attributes: { class: 'pulpo-doc-editor', 'aria-label': ui("Document") },
    },
  }, [session])

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  if (!editor) return null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-1.5 backdrop-blur sm:px-6">
        <div className="min-w-0 flex-1 overflow-x-auto"><DocToolbar editor={editor} /></div>
        {toolbarSlot}
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-8">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
