import { useCallback, useEffect, useRef, useState } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import type { DocxEditor } from '@pulpo/client-core/office/docx/view'
import { ListTree, MessageSquare, PenLine } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { EditorMenuBar } from '../chrome/EditorMenuBar'
import { fileEditorRoot } from '../chrome/editor-root'
import { fileMenuDefinition, type FileMenuHost } from '../chrome/file-menu'
import { LinkDialog, type LinkDialogValue } from '../chrome/LinkDialog'
import { separator, shortcutGroupsFromMenus, type MenuDefinition } from '../chrome/menu'
import { ShortcutsDialog } from '../chrome/ShortcutsDialog'
import { findEntries, helpMenu, undoRedoEntries } from '../chrome/standard-menus'
import { useEditorShortcuts } from '../chrome/use-editor-shortcuts'
import { zoomMenu } from '../chrome/zoom'
import { CommentsPanel, FindBar, OutlinePanel, ReviewPanel, StatusBar } from './DocxPanels'
import { docxShortcutGroups } from './docx-shortcuts'
import { DocxToolbar, type ToolbarPanels } from './DocxToolbar'
import { useDocxEditor, useDocxState, type DocxEditorProps } from './use-docx-editor'

interface LinkRequest {
  url: string
  /** The caret is in a link: the dialog edits it, and can remove it. */
  editing: boolean
  /** Nothing is selected: the dialog asks for the text to insert. */
  showText: boolean
}

/**
 * Extends an empty selection inside a link to the whole link, so editing or removing it changes
 * the link rather than inserting new text at the caret. Body text only: header, footer, and note
 * editors keep the selection as it is.
 */
function selectLinkAtCaret(editor: DocxEditor): void {
  const { view } = editor
  const { state } = view
  if (editor.editingStory || !state.selection.empty) return
  const type = state.schema.marks.link
  const { $from } = state.selection
  const mark = type && $from.marks().find((candidate) => candidate.type === type)
  if (!mark) return
  const runs: [number, number][] = []
  let position = $from.start()
  $from.parent.forEach((child) => {
    const end = position + child.nodeSize
    if (mark.isInSet(child.marks)) {
      const last = runs[runs.length - 1]
      if (last && last[1] === position) last[1] = end
      else runs.push([position, end])
    }
    position = end
  })
  const run = runs.find(([from, to]) => from <= $from.pos && $from.pos <= to)
  if (run) view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, run[0], run[1])))
}

/**
 * A Word document editor: menu bar, toolbar, page canvas, and the outline, comments, and tracked
 * changes panels around the client-core editor. The document, its awareness, and its assets come
 * from the host (the Files page, or the test harness), with the host's File menu entries.
 */
export function DocxEditorView({ className, onEditor, toolbarSlot, fileMenu, onSaveShortcut, ...props }: DocxEditorProps & {
  className?: string
  onEditor?: (editor: DocxEditor | null) => void
  toolbarSlot?: React.ReactNode
  fileMenu?: FileMenuHost
  onSaveShortcut?: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const editor = useDocxEditor(host, props)
  const state = useDocxState(editor)
  const [panels, setPanels] = useState<ToolbarPanels>({ outline: false, comments: false, review: false })
  const [find, setFind] = useState<'find' | 'replace' | null>(null)
  const [link, setLink] = useState<LinkRequest | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useEffect(() => { onEditor?.(editor) }, [editor, onEditor])

  const requestLink = useCallback(() => {
    // Suggesting mode cannot track link changes, so it offers none (the Link button is disabled too).
    const current = editor?.state()
    if (!current?.untrackedFormattingEditable) return
    setLink({ url: current.link ?? '', editing: Boolean(current.link), showText: current.empty && !current.link })
  }, [editor])

  const applyLink = ({ text, url }: LinkDialogValue) => {
    if (!editor || !link) return
    if (link.editing) selectLinkAtCaret(editor)
    editor.setLink(url, link.showText ? text || undefined : undefined)
  }
  const removeLink = () => {
    if (!editor) return
    selectLinkAtCaret(editor)
    editor.setLink(null)
  }

  useEffect(() => {
    if (!editor) return
    const stopRequest = editor.on('request', (request) => {
      if (request === 'link') requestLink()
      else if (request === 'find' || request === 'replace') setFind(request)
      else if (request === 'comment') setPanels((current) => ({ ...current, comments: true }))
    })
    const stopComment = editor.on('activeComment', (id) => {
      if (id) setPanels((current) => (current.comments ? current : { ...current, comments: true }))
    })
    return () => {
      stopRequest()
      stopComment()
    }
  }, [editor, requestLink])

  useEditorShortcuts(root, {
    print: () => editor?.print(),
    save: onSaveShortcut,
    shortcuts: () => setShortcutsOpen(true),
    find: () => setFind('find'),
    replace: () => setFind('replace'),
    focus: () => editor?.focus(),
  })

  const togglePanel = (panel: keyof ToolbarPanels) => setPanels((current) => ({ ...current, [panel]: !current[panel] }))

  const menus: MenuDefinition[] = editor ? [
    fileMenuDefinition(fileMenu, () => ({ print: () => editor.print() })),
    {
      id: 'edit',
      label: ui("Edit"),
      items: () => {
        const current = editor.state()
        return [
          ...undoRedoEntries({ undo: () => editor.undo(), redo: () => editor.redo(), canUndo: !current.readOnly && current.canUndo, canRedo: !current.readOnly && current.canRedo }),
          separator,
          ...findEntries({ find: () => setFind('find'), replace: current.readOnly ? undefined : () => setFind('replace') }),
        ]
      },
    },
    {
      id: 'view',
      label: ui("View"),
      items: () => {
        const current = editor.state()
        return [
          { type: 'item', id: 'layout-print', label: ui("Print layout"), radio: true, checked: current.layout === 'print', onSelect: () => editor.setLayout('print') },
          { type: 'item', id: 'layout-web', label: ui("Web layout"), radio: true, checked: current.layout === 'web', onSelect: () => editor.setLayout('web') },
          separator,
          zoomMenu({ zoom: current.zoom, onZoom: (zoom) => editor.setZoom(zoom) }),
          separator,
          { type: 'item', id: 'outline', label: ui("Outline"), icon: ListTree, checked: panels.outline, onSelect: () => togglePanel('outline') },
          { type: 'item', id: 'comments', label: ui("Comments"), icon: MessageSquare, checked: panels.comments, disabled: Boolean(editor.editingStory), onSelect: () => togglePanel('comments') },
          { type: 'item', id: 'review', label: ui("Review changes"), icon: PenLine, checked: panels.review, onSelect: () => togglePanel('review') },
        ]
      },
    },
    helpMenu(() => setShortcutsOpen(true)),
  ] : []

  return (
    <div ref={root} className={cn('flex h-full min-h-0 flex-col bg-background', className)} data-docx-editor {...fileEditorRoot('document')}>
      <div className="z-10 border-b bg-background/95 px-3 pt-0.5 pb-1.5 backdrop-blur">
        {editor && state ? (
          <>
            <EditorMenuBar menus={menus} onClose={() => editor.focus()} className="-mx-1" />
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1"><DocxToolbar editor={editor} state={state} onRequestLink={requestLink} onTogglePanel={togglePanel} panels={panels} /></div>
              {toolbarSlot}
            </div>
          </>
        ) : (
          <div className="h-[3.75rem]" />
        )}
      </div>
      {editor && find && <FindBar editor={editor} replaceOpen={find === 'replace'} onClose={() => setFind(null)} />}
      <div className="flex min-h-0 flex-1">
        {editor && panels.outline && <OutlinePanel editor={editor} onClose={() => togglePanel('outline')} />}
        <div className="relative min-w-0 flex-1 overflow-auto bg-muted [--docx-desk:var(--muted)]" data-docx-scroller>
          <div ref={host} className="min-w-fit" />
        </div>
        {editor && panels.comments && <CommentsPanel editor={editor} onClose={() => togglePanel('comments')} />}
        {editor && panels.review && <ReviewPanel editor={editor} onClose={() => togglePanel('review')} />}
      </div>
      {editor && <StatusBar editor={editor} />}
      {editor && (
        <>
          <LinkDialog
            open={link !== null}
            onOpenChange={(open) => { if (!open) setLink(null) }}
            url={link?.url}
            editing={link?.editing}
            showText={link?.showText}
            onApply={applyLink}
            onRemove={removeLink}
            returnFocus={() => editor.focus()}
          />
          <ShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
            groups={() => shortcutGroupsFromMenus(menus, docxShortcutGroups())}
            returnFocus={() => editor.focus()}
          />
        </>
      )}
    </div>
  )
}
