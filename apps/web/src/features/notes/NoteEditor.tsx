import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent } from 'react'
import {
  Bold, CheckSquare, Code, Code2, FileUp, Heading1, Heading2, Heading3, Italic, Link as LinkIcon,
  List, ListOrdered, Minus, Quote, Redo2, Strikethrough, Table as TableIcon, Underline as UnderlineIcon, Undo2,
} from 'lucide-react'
import type { NoteRole } from '@pulpo/contracts'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { TableKit } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from '@tiptap/markdown'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type { Editor } from '@tiptap/core'
import type * as Y from 'yjs'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { NoteAttachment } from './NoteAttachment'
import { getLinkPreview, uploadNoteAttachment } from './api'
import { NoteLinkPreview } from './NoteLinkPreview'
import { NoteUnderline } from './NoteUnderline'

function ToolbarButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} className={cn('flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35', active && 'bg-accent text-foreground')}>{children}</button>
}

function NoteToolbar({ editor, onUpload, onPreview }: { editor: Editor | null; onUpload: () => void; onPreview: (url: string) => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'), strike: current.isActive('strike'),
      h1: current.isActive('heading', { level: 1 }), h2: current.isActive('heading', { level: 2 }), h3: current.isActive('heading', { level: 3 }),
      bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'), task: current.isActive('taskList'), quote: current.isActive('blockquote'), inlineCode: current.isActive('code'), code: current.isActive('codeBlock'),
    } : null,
  })
  if (!editor) return null
  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    const value = window.prompt(ui('Link URL'), previous ?? 'https://')
    if (value === null) return
    if (!value.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: value.trim() }).run()
      onPreview(value.trim())
    }
  }
  return <div className="note-toolbar flex flex-wrap items-center gap-0.5 border-b bg-background/95 px-3 py-2">
    <ToolbarButton label={ui('Heading 1')} active={state?.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 /></ToolbarButton>
    <ToolbarButton label={ui('Heading 2')} active={state?.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></ToolbarButton>
    <ToolbarButton label={ui('Heading 3')} active={state?.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 /></ToolbarButton>
    <span className="mx-1 h-5 w-px bg-border" />
    <ToolbarButton label={ui('Bold')} active={state?.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></ToolbarButton>
    <ToolbarButton label={ui('Italic')} active={state?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></ToolbarButton>
    <ToolbarButton label={ui('Underline')} active={state?.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon /></ToolbarButton>
    <ToolbarButton label={ui('Strikethrough')} active={state?.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></ToolbarButton>
    <ToolbarButton label={ui('Link')} active={editor.isActive('link')} onClick={setLink}><LinkIcon /></ToolbarButton>
    <span className="mx-1 h-5 w-px bg-border" />
    <ToolbarButton label={ui('Blockquote')} active={state?.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></ToolbarButton>
    <ToolbarButton label={ui('Bulleted list')} active={state?.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></ToolbarButton>
    <ToolbarButton label={ui('Numbered list')} active={state?.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></ToolbarButton>
    <ToolbarButton label={ui('Task list')} active={state?.task} onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare /></ToolbarButton>
    <ToolbarButton label={ui('Inline code')} active={state?.inlineCode} onClick={() => editor.chain().focus().toggleCode().run()}><Code2 /></ToolbarButton>
    <ToolbarButton label={ui('Code block')} active={state?.code} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code /></ToolbarButton>
    <ToolbarButton label={ui('Divider')} onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus /></ToolbarButton>
    <ToolbarButton label={ui('Table')} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon /></ToolbarButton>
    <ToolbarButton label={ui('Upload file')} onClick={onUpload}><FileUp /></ToolbarButton>
    <span className="mx-1 h-5 w-px bg-border" />
    <ToolbarButton label={ui('Undo')} disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 /></ToolbarButton>
    <ToolbarButton label={ui('Redo')} disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 /></ToolbarButton>
  </div>
}

function localCaretUser() {
  const user = useAuth.getState().user
  return { name: user?.name ?? ui('Anonymous'), color: user?.profileColor ?? '#2563eb' }
}

export interface NoteEditorHandle {
  getMarkdown(): string
  applyMarkdown(markdown: string): void
}

export const NoteEditor = forwardRef<NoteEditorHandle, {
  noteId: string
  document: Y.Doc
  provider: HocuspocusProvider
  role: NoteRole
  sourceMode: boolean
  readOnly: boolean
  onSourceChanged?: (markdown: string) => void
}>(function NoteEditor({ noteId, document, provider, role, sourceMode, readOnly, onSourceChanged }, ref) {
  const editable = role !== 'viewer' && !readOnly && !sourceMode
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const titleEditor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ undoRedo: false, underline: false }),
      NoteUnderline,
      Collaboration.configure({ document, field: 'title', provider }),
      CollaborationCaret.configure({ provider, user: localCaretUser() }),
    ],
    editable,
    editorProps: {
      attributes: { class: 'note-title-editor' },
      handleKeyDown: (_view, event) => event.key === 'Enter',
      transformPastedText: (text) => text.replace(/[\r\n]+/g, ' '),
    },
  }, [noteId])
  const bodyEditor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ undoRedo: false, underline: false, link: { openOnClick: false, autolink: true }, heading: { levels: [1, 2, 3] } }),
      NoteUnderline,
      TableKit.configure({ table: { resizable: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      NoteAttachment,
      NoteLinkPreview,
      Markdown.configure({ markedOptions: { gfm: true } }),
      Collaboration.configure({ document, field: 'body', provider }),
      CollaborationCaret.configure({ provider, user: localCaretUser() }),
    ],
    editable,
    editorProps: { attributes: { class: 'note-body-editor' } },
    onUpdate: ({ editor }) => onSourceChanged?.(editor.getMarkdown()),
  }, [noteId])

  useEffect(() => { titleEditor?.setEditable(editable); bodyEditor?.setEditable(editable) }, [bodyEditor, editable, titleEditor])
  useEffect(() => { if (sourceMode && bodyEditor) onSourceChanged?.(bodyEditor.getMarkdown()) }, [bodyEditor, onSourceChanged, sourceMode])
  useImperativeHandle(ref, () => ({
    getMarkdown: () => bodyEditor?.getMarkdown() ?? '',
    applyMarkdown: (markdown: string) => { bodyEditor?.commands.setContent(markdown, { contentType: 'markdown' }) },
  }), [bodyEditor])

  const uploadFiles = async (files: File[]) => {
    if (!bodyEditor || !editable || files.length === 0) return
    setUploading(true)
    try {
      for (const file of files) {
        const attachment = await uploadNoteAttachment(noteId, file)
        bodyEditor.chain().focus().insertContent({
          type: 'noteAttachment',
          attrs: {
            attachmentId: attachment.id,
            name: attachment.originalName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            kind: attachment.mimeType.startsWith('image/') ? 'image' : 'file',
          },
        }).run()
      }
    } finally { setUploading(false); if (fileInput.current) fileInput.current.value = '' }
  }
  const insertLinkPreview = async (url: string) => {
    if (!bodyEditor || !editable) return
    try {
      const preview = await getLinkPreview(url)
      bodyEditor.chain().focus().insertContent({ type: 'noteLinkPreview', attrs: preview }).run()
    } catch { /* Links still work even when a remote site refuses previews. */ }
  }
  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => void uploadFiles([...event.target.files ?? []])
  const onDrop = (event: ReactDragEvent) => {
    const files = [...event.dataTransfer.files]
    if (!files.length) return
    event.preventDefault()
    void uploadFiles(files)
  }
  const onPaste = (event: React.ClipboardEvent) => {
    const files = [...event.clipboardData.files]
    if (files.length) { event.preventDefault(); void uploadFiles(files); return }
    const text = event.clipboardData.getData('text/plain').trim()
    if (/^https?:\/\/\S+$/i.test(text)) { event.preventDefault(); void insertLinkPreview(text) }
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <EditorContent editor={titleEditor} />
    {!sourceMode && editable && <NoteToolbar editor={bodyEditor} onUpload={() => fileInput.current?.click()} onPreview={(url) => void insertLinkPreview(url)} />}
    <input ref={fileInput} className="hidden" type="file" multiple onChange={onFileInput} />
    {!sourceMode && <div className="min-h-0 flex-1 overflow-y-auto" onDrop={onDrop} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onPaste={onPaste}>
      <EditorContent editor={bodyEditor} />
      {uploading && <div className="pointer-events-none fixed bottom-5 right-5 rounded-full border bg-background px-3 py-1.5 text-xs shadow-lg">{ui('Uploading…')}</div>}
    </div>}
  </div>
})
