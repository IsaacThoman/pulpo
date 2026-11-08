import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { TextSelection } from '@tiptap/pm/state'
import type { DocxEditor, HeaderFooterKind, ParagraphFormat } from '@pulpo/client-core/office/docx/view'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useFileToasts } from '../../browser/toasts'
import { EditorMenuBar } from '../chrome/EditorMenuBar'
import { fileEditorRoot } from '../chrome/editor-root'
import type { FileMenuHost } from '../chrome/file-menu'
import { LinkDialog, type LinkDialogValue } from '../chrome/LinkDialog'
import { shortcutGroupsFromMenus } from '../chrome/menu'
import { saveFile } from '../chrome/output'
import { matchesShortcut } from '../chrome/shortcuts'
import { ShortcutsDialog } from '../chrome/ShortcutsDialog'
import { useEditorShortcuts } from '../chrome/use-editor-shortcuts'
import { CommentsPanel, FindBar, HeaderFooterBar, OutlinePanel, ReviewPanel, StatusBar } from './DocxPanels'
import { wantsContextMenu, type DocxContextMenuState } from './docx-context'
import { DocxContextMenu } from './DocxContextMenu'
import { copyFromMenu, pasteFromClipboard, selectAll } from './docx-clipboard'
import { docxMenus } from './docx-menus'
import { useDocxPreferences } from './docx-preferences'
import { docxShortcutGroups, WORD_COUNT_SHORTCUT } from './docx-shortcuts'
import { docxPlainText, plainTextName } from './docx-text'
import { DocxToolbar, type ToolbarPanels } from './DocxToolbar'
import { LinkBubble } from './LinkBubble'
import { measurementUnit } from './page-units'
import { PageSetupDialog, type PageSetupState } from './PageSetupDialog'
import { ParagraphDialog } from './ParagraphDialog'
import type { ParagraphDialogFocus } from './paragraph-format'
import { useDocxEditor, useDocxState, type DocxEditorProps } from './use-docx-editor'
import { WordCountDialog, type WordCounts } from './WordCountDialog'

interface LinkRequest {
  url: string
  /** The caret is in a link: the dialog edits it, and can remove it. */
  editing: boolean
  /** Nothing is selected: the dialog asks for the text to insert. */
  showText: boolean
}

/** Pictures the editor takes, for the file picker (insertImage refuses anything else). */
const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/bmp'
const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100))
/** A bookmark target ("#Introduction") is a link too, as in Word's Insert Link ▸ Place in this document. */
const acceptBookmark = (value: string) => (/^#\S+$/.test(value) ? value : undefined)

/**
 * A right-click on a link's first character resolves to the position before it; the caret goes
 * inside, so Edit link and Remove link change the whole link (body text only).
 */
function caretIntoLink(editor: DocxEditor, info: DocxContextMenuState['info']): void {
  const link = info.link
  if (!link || info.storyId || !info.editable) return
  const { state } = editor.view
  if (!state.selection.empty || (state.selection.from > link.from && state.selection.from <= link.to)) return
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, Math.min(link.from + 1, link.to))))
}

/**
 * A Word document editor: menu bar, toolbar, page canvas, and the outline, comments, and tracked
 * changes panels around the client-core editor, with Word's and Docs' dialogs (page setup,
 * paragraph, word count, links), a right-click menu for tables, pictures, links, and comments,
 * and a status bar. The document, its awareness, and its assets come from the host (the Files
 * page, or the test harness), with the host's File menu entries.
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
  const imageInput = useRef<HTMLInputElement>(null)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const editor = useDocxEditor(host, props)
  const state = useDocxState(editor)
  const [preferences, setPreferences] = useDocxPreferences()
  const [panels, setPanels] = useState<ToolbarPanels>({ outline: false, comments: false, review: false })
  const panelsRef = useRef(panels)
  panelsRef.current = panels
  const [find, setFind] = useState<'find' | 'replace' | null>(null)
  const [link, setLink] = useState<LinkRequest | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [showMarkup, setShowMarkupState] = useState(true)
  const [pageSetup, setPageSetup] = useState<{ open: boolean; setup: PageSetupState | null }>({ open: false, setup: null })
  const [paragraph, setParagraph] = useState<{ open: boolean; format: ParagraphFormat | null; focus: ParagraphDialogFocus }>({ open: false, format: null, focus: 'indents' })
  const [wordCount, setWordCount] = useState<{ open: boolean; counts: WordCounts | null }>({ open: false, counts: null })
  const [contextMenu, setContextMenu] = useState<DocxContextMenuState | null>(null)
  // Each request for a new comment focuses the comments panel's box; Escape there closes a panel it opened.
  const [draftRequest, setDraftRequest] = useState(0)
  const draftOpenedPanel = useRef(false)
  const [fitted, setFitted] = useState(false)
  const unit = useMemo(() => measurementUnit(), [])
  useEffect(() => { onEditor?.(editor) }, [editor, onEditor])
  // A comments panel opened later (View ▸ Comments) starts without a new comment in focus.
  useEffect(() => {
    if (panels.comments) return
    setDraftRequest(0)
    draftOpenedPanel.current = false
  }, [panels.comments])
  useEffect(() => { editor?.setAutoformat(preferences.autoformat) }, [editor, preferences.autoformat])

  const requestLink = useCallback(() => {
    // Suggesting mode cannot track link changes, so it offers none (the Link button is disabled too).
    const current = editor?.state()
    if (!editor || !current?.untrackedFormattingEditable) return
    // At a caret in (or at the end of) a link, the dialog edits the whole link.
    const existing = editor.linkAt()
    const url = existing ? existing.href ?? (existing.anchor ? `#${existing.anchor}` : '') : current.link ?? ''
    const editing = Boolean(existing || current.link)
    setLink({ url, editing, showText: current.empty && !editing })
  }, [editor])

  const requestComment = useCallback(() => {
    if (!editor?.canComment) return
    draftOpenedPanel.current = !panelsRef.current.comments
    // Rendered now, so the comment box has focus before the next key: typing right after
    // Cmd/Ctrl+Alt+M must not replace the selected text.
    flushSync(() => {
      setPanels((current) => (current.comments ? current : { ...current, comments: true }))
      setDraftRequest((count) => count + 1)
    })
  }, [editor])

  const openImagePicker = useCallback(() => imageInput.current?.click(), [])

  const openWordCount = useCallback(() => {
    if (!editor) return
    const selected = !editor.state().empty
    setWordCount({
      open: true,
      counts: {
        document: editor.wordCount('document'),
        selection: selected ? editor.wordCount('selection') : null,
        pages: editor.layout === 'print' ? editor.pages : undefined,
      },
    })
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const stopRequest = editor.on('request', (request) => {
      if (request === 'link') requestLink()
      else if (request === 'find' || request === 'replace') setFind(request)
      else if (request === 'comment') requestComment()
      else if (request === 'image') openImagePicker()
    })
    const stopComment = editor.on('activeComment', (id) => {
      if (id) setPanels((current) => (current.comments ? current : { ...current, comments: true }))
    })
    const stopRefused = editor.on('imageRefused', ({ name, reason }) => {
      if (reason !== 'unsupported') return
      useFileToasts.getState().show({
        tone: 'error',
        message: name
          ? ui("Couldn't insert {{name}}. Only PNG, JPEG, GIF, and BMP pictures can be inserted.", { name })
          : ui("Only PNG, JPEG, GIF, and BMP pictures can be inserted."),
      })
    })
    return () => {
      stopRequest()
      stopComment()
      stopRefused()
    }
  }, [editor, requestLink, requestComment, openImagePicker])

  // Right-click: Pulpo's menu over tables, pictures, links, and comments; the browser's elsewhere
  // (spelling suggestions), and always with Shift.
  useEffect(() => {
    if (!editor || !scroller) return
    const onContextMenu = (event: MouseEvent) => {
      if (event.shiftKey) return
      const info = editor.contextAt(event.clientX, event.clientY)
      if (!wantsContextMenu(info)) return
      event.preventDefault()
      const selected = editor.contextAt(event.clientX, event.clientY, { select: true }) ?? info
      caretIntoLink(editor, selected)
      const point = { x: event.clientX, y: event.clientY }
      // Open once the click is over, so its release cannot pick an item.
      setTimeout(() => setContextMenu({ ...point, info: selected }), 0)
    }
    scroller.addEventListener('contextmenu', onContextMenu)
    return () => scroller.removeEventListener('contextmenu', onContextMenu)
  }, [editor, scroller])

  // Ctrl/Cmd+wheel (and pinching a trackpad) zooms the pages around the pointer, as in Word; zoom is the viewer's own.
  useEffect(() => {
    if (!editor || !scroller) return
    let wanted: number | null = null
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const before = editor.zoom
      if (wanted === null || clampZoom(wanted) !== before) wanted = before
      const scale = event.deltaMode === 1 ? 0.033 : event.deltaMode === 2 ? 0.5 : 0.001
      wanted = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, wanted * Math.exp(-event.deltaY * scale)))
      const next = clampZoom(wanted)
      if (next === before) return
      const offset = event.clientY - scroller.getBoundingClientRect().top
      const anchor = (scroller.scrollTop + offset) / before
      setFitted(false)
      editor.setZoom(next)
      scroller.scrollTop = anchor * next - offset
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [editor, scroller])

  // Fit: the page as wide as the window, kept so as the window or the paper size changes.
  const fitZoom = useCallback((): number | null => {
    if (!editor || !scroller || editor.layout !== 'print') return null
    const pageWidth = (editor.pageSetup().width * 96) / 72
    return pageWidth ? clampZoom(Math.floor(((scroller.clientWidth - 48) / pageWidth) * 100) / 100) : null
  }, [editor, scroller])
  useEffect(() => {
    if (!fitted || !editor || !scroller) return
    const apply = () => {
      const zoom = fitZoom()
      if (zoom !== null && Math.abs(zoom - editor.zoom) > 0.005) editor.setZoom(zoom)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(scroller)
    const stop = editor.on('layout', apply)
    return () => {
      observer.disconnect()
      stop()
    }
  }, [fitted, editor, scroller, fitZoom])
  useEffect(() => { if (state?.layout === 'web') setFitted(false) }, [state?.layout])
  const setZoom = useCallback((zoom: number) => {
    setFitted(false)
    editor?.setZoom(zoom)
  }, [editor])

  useEditorShortcuts(root, {
    print: () => editor?.print(),
    save: onSaveShortcut,
    shortcuts: () => setShortcutsOpen(true),
    find: () => setFind('find'),
    replace: () => setFind('replace'),
    focus: () => editor?.focus(),
  })

  const togglePanel = (panel: keyof ToolbarPanels) => setPanels((current) => ({ ...current, [panel]: !current[panel] }))
  const applyLink = ({ text, url }: LinkDialogValue) => {
    if (!editor || !link) return
    editor.setLink(url, link.showText ? text || undefined : undefined)
  }
  const removeLink = () => editor?.setLink(null)
  /** Headers and footers live on pages: from web layout, the pages come back first. */
  const printLayout = (target: DocxEditor) => {
    if (target.layout === 'print') return
    target.setLayout('print')
    target.relayout()
  }

  const menus = editor ? docxMenus({
    editor,
    fileMenu,
    documentReadOnly: props.readOnly,
    panels,
    togglePanel,
    showMarkup,
    setShowMarkup: (show) => {
      setShowMarkupState(show)
      editor.setShowMarkup(show)
    },
    preferences,
    setPreferences,
    zoom: { fitted, fit: () => setFitted(true), set: setZoom },
    find: setFind,
    requestLink,
    requestComment,
    insertImage: openImagePicker,
    insertHeaderFooter: (kind: HeaderFooterKind) => {
      printLayout(editor)
      editor.addHeaderFooter(kind)
    },
    insertPageNumber: (options) => {
      if (options.kind) printLayout(editor)
      editor.insertPageNumber(options)
    },
    cut: () => copyFromMenu(editor, true),
    copy: () => copyFromMenu(editor, false),
    paste: (plain) => void pasteFromClipboard(editor, plain),
    selectAll: () => selectAll(editor),
    downloadText: () => saveFile(new TextEncoder().encode(docxPlainText(props.doc)), plainTextName(fileMenu?.name), 'text/plain;charset=utf-8'),
    openPageSetup: () => setPageSetup({ open: true, setup: editor.pageSetup() }),
    openParagraph: (focus) => {
      const format = editor.paragraphFormat()
      if (format) setParagraph({ open: true, format, focus })
    },
    openWordCount,
    showShortcuts: () => setShortcutsOpen(true),
  }) : []

  const editingHeaderFooter = state?.editingStory && /^(header|footer):/.test(state.editingStory) ? state.editingStory : null
  const dialogOpen = link !== null || shortcutsOpen || pageSetup.open || paragraph.open || wordCount.open || contextMenu !== null

  return (
    <div
      ref={root}
      className={cn('flex h-full min-h-0 flex-col bg-background', className)}
      data-docx-editor
      {...fileEditorRoot('document')}
      onKeyDown={(event) => {
        // Docs' Cmd/Ctrl+Shift+C, from the document or its toolbar (not a dialog portaled out of it).
        if (event.defaultPrevented || !root.current?.contains(event.target as Node) || !matchesShortcut(event.nativeEvent, WORD_COUNT_SHORTCUT)) return
        event.preventDefault()
        if (!event.repeat) openWordCount()
      }}
    >
      <div className="z-10 border-b bg-background/95 px-3 pt-0.5 pb-1.5 backdrop-blur">
        {editor && state ? (
          <>
            <EditorMenuBar menus={menus} onClose={() => editor.focus()} className="-mx-1" />
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <DocxToolbar
                  editor={editor}
                  state={state}
                  onRequestLink={requestLink}
                  onRequestComment={requestComment}
                  onInsertImage={openImagePicker}
                  onTogglePanel={togglePanel}
                  panels={panels}
                />
              </div>
              {toolbarSlot}
            </div>
          </>
        ) : (
          <div className="h-[3.75rem]" />
        )}
      </div>
      <input
        ref={imageInput}
        type="file"
        accept={IMAGE_TYPES}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file && editor) void editor.insertImage(file, file.name)
          event.target.value = ''
        }}
      />
      {editor && find && <FindBar editor={editor} replaceOpen={find === 'replace'} onClose={() => setFind(null)} />}
      {editor && editingHeaderFooter && <HeaderFooterBar editor={editor} storyId={editingHeaderFooter} editable={Boolean(state?.untrackedFormattingEditable)} />}
      <div className="flex min-h-0 flex-1">
        {editor && panels.outline && <OutlinePanel editor={editor} onClose={() => togglePanel('outline')} />}
        <div ref={setScroller} className="relative min-w-0 flex-1 overflow-auto bg-muted [--docx-desk:var(--muted)]" data-docx-scroller>
          <div ref={host} className="min-w-fit" />
          {editor && <LinkBubble editor={editor} container={scroller} suppressed={dialogOpen} onEdit={requestLink} onRemove={removeLink} />}
        </div>
        {editor && panels.comments && (
          <CommentsPanel
            editor={editor}
            user={props.user.name}
            draftRequest={draftRequest}
            onClose={() => togglePanel('comments')}
            onDraftCancel={() => {
              if (draftOpenedPanel.current) setPanels((current) => ({ ...current, comments: false }))
              draftOpenedPanel.current = false
              editor.focus()
            }}
          />
        )}
        {editor && panels.review && (
          <ReviewPanel
            editor={editor}
            onClose={() => togglePanel('review')}
            showMarkup={showMarkup}
            onShowMarkupChange={(show) => {
              setShowMarkupState(show)
              editor.setShowMarkup(show)
            }}
          />
        )}
      </div>
      {editor && state && (
        <StatusBar
          editor={editor}
          state={state}
          showWordCount={preferences.wordCount}
          onWordCount={openWordCount}
          zoom={{ fitted, onFit: () => setFitted(true), onZoom: setZoom }}
        />
      )}
      {editor && (
        <>
          <LinkDialog
            open={link !== null}
            onOpenChange={(open) => { if (!open) setLink(null) }}
            url={link?.url}
            editing={link?.editing}
            showText={link?.showText}
            accept={acceptBookmark}
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
          <PageSetupDialog
            open={pageSetup.open}
            onOpenChange={(open) => setPageSetup((current) => ({ ...current, open }))}
            setup={pageSetup.setup}
            unit={unit}
            suggesting={state?.mode === 'suggesting'}
            onApply={(change, scope) => editor.setPageSetup(change, scope)}
            returnFocus={() => editor.focus()}
          />
          <ParagraphDialog
            open={paragraph.open}
            onOpenChange={(open) => setParagraph((current) => ({ ...current, open }))}
            format={paragraph.format}
            focus={paragraph.focus}
            unit={unit}
            onApply={(change) => editor.setParagraphFormat(change)}
            returnFocus={() => editor.focus()}
          />
          <WordCountDialog
            open={wordCount.open}
            onOpenChange={(open) => setWordCount((current) => ({ ...current, open }))}
            counts={wordCount.counts}
            showWhileTyping={preferences.wordCount}
            onShowWhileTypingChange={(show) => setPreferences({ wordCount: show })}
            returnFocus={() => editor.focus()}
          />
          <DocxContextMenu
            editor={editor}
            menu={contextMenu}
            onClose={() => setContextMenu(null)}
            onEditLink={requestLink}
            onOpenComment={(id) => editor.setActiveComment(id)}
          />
        </>
      )}
    </div>
  )
}
