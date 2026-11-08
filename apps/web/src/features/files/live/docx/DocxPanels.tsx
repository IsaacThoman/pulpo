import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { CommentThread, DocxEditor, DocxFormattingState, HeaderFooterKind, Revision } from '@pulpo/client-core/office/docx/view'
import { ArrowDown, ArrowUp, CaseSensitive, Check, ChevronDown, ChevronUp, Hash, MessageCircleReply, Pencil, Replace, Trash2, WholeWord, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { activeLocale, ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { ZoomControl } from '../chrome/ZoomControl'
import { ToolbarButton } from './DocxToolbar'
import { headerFooterName, wordCountLabel } from './docx-names'
import { useEditorValue } from './use-editor-value'

export function PanelFrame({ title, onClose, children, className }: { title: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  return (
    <aside className={cn('flex w-72 shrink-0 flex-col border-l bg-background', className)} aria-label={title}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
        <ToolbarButton label={ui("Close")} onClick={onClose}><X className="size-4" /></ToolbarButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  )
}

export function OutlinePanel({ editor, onClose }: { editor: DocxEditor; onClose: () => void }) {
  const outline = useEditorValue(editor, () => editor.outline(6))
  return (
    <PanelFrame title={ui("Outline")} onClose={onClose} className="border-l-0 border-r">
      {outline.length ? (
        <nav className="p-2" data-docx-outline>
          {outline.map((entry) => (
            <button
              key={entry.pos}
              type="button"
              onClick={() => editor.goTo(entry.pos, entry.storyId)}
              className="block w-full cursor-pointer truncate rounded-md py-1 pr-2 text-left text-sm hover:bg-accent"
              style={{ paddingLeft: `${8 + entry.level * 12}px` }}
            >
              {entry.text}
            </button>
          ))}
        </nav>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{ui("Headings you add to the document appear here.")}</p>
      )}
    </PanelFrame>
  )
}

function formatDate(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(activeLocale(), { dateStyle: 'medium', timeStyle: 'short' })
}

/** Ctrl/Cmd+Enter sends and Escape cancels, as in Docs' comment boxes. */
function commentKeys(event: React.KeyboardEvent<HTMLTextAreaElement>, { submit, cancel }: { submit: () => void; cancel: () => void }): void {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    submit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }
}

/** A comment's text, or a box editing it in place (the viewer's own comments). */
function CommentBody({ editor, id, text, editing, onDone }: { editor: DocxEditor; id: string; text: string; editing: boolean; onDone: () => void }) {
  const [draft, setDraft] = useState(text)
  if (!editing) return <p className="mt-1 whitespace-pre-wrap break-words">{text}</p>
  const save = () => {
    const next = draft.trim()
    if (next && next !== text) editor.editComment(id, next)
    onDone()
  }
  return (
    <form className="mt-1 flex flex-col gap-1.5" onSubmit={(event) => { event.preventDefault(); save() }}>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => commentKeys(event, { submit: save, cancel: onDone })}
        onFocus={(event) => event.currentTarget.select()}
        aria-label={ui("Edit comment")}
        rows={2}
        autoFocus
      />
      <div className="flex justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{ui("Cancel")}</Button>
        <Button type="submit" size="sm" disabled={!draft.trim()}>{ui("Save")}</Button>
      </div>
    </form>
  )
}

/** Whether a comment is the viewer's own. Word files keep author names, not accounts, so names decide. */
const isOwn = (author: string | undefined, user: string | undefined) => Boolean(user && author === user)

function CommentCard({ editor, thread, active, user }: { editor: DocxEditor; thread: CommentThread; active: boolean; user?: string }) {
  const [reply, setReply] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const readOnly = !editor.canComment
  const editButton = (id: string, author: string | undefined) => !readOnly && isOwn(author, user) && editing !== id && (
    <ToolbarButton label={ui("Edit comment")} onClick={() => setEditing(id)}>
      <Pencil className="size-3.5" />
    </ToolbarButton>
  )
  return (
    <article
      data-comment={thread.id}
      onClick={(event) => {
        editor.setActiveComment(thread.id)
        // A click on the card itself (not a button or box) shows its text in the document, as in Docs.
        if (!(event.target as Element).closest('button, input, textarea, a, form')) editor.goTo(thread.pos)
      }}
      className={cn('cursor-pointer rounded-lg border bg-card p-3 text-sm shadow-xs transition-colors', active && 'border-primary ring-1 ring-primary/30', thread.meta.done && 'opacity-70')}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{thread.meta.author ?? ui("Unknown author")}</div>
          <div className="text-xs text-muted-foreground">{formatDate(thread.meta.date)}</div>
        </div>
        {editButton(thread.id, thread.meta.author)}
        {!readOnly && (
          <>
            <ToolbarButton label={thread.meta.done ? ui("Reopen") : ui("Resolve")} active={thread.meta.done} onClick={() => editor.resolveComment(thread.id, !thread.meta.done)}>
              <Check className="size-4" />
            </ToolbarButton>
            <ToolbarButton label={ui("Delete comment")} onClick={() => editor.deleteComment(thread.id)}>
              <Trash2 className="size-4" />
            </ToolbarButton>
          </>
        )}
      </header>
      <CommentBody key={editing === thread.id ? 'editing' : 'text'} editor={editor} id={thread.id} text={thread.text} editing={editing === thread.id} onDone={() => setEditing(null)} />
      {thread.replies.map((item) => (
        <div key={item.id} className="mt-2 border-t pt-2" data-comment-reply={item.id}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate font-medium">{item.meta.author ?? ui("Unknown author")}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{formatDate(item.meta.date)}</span>
            {editButton(item.id, item.meta.author)}
          </div>
          <CommentBody key={editing === item.id ? 'editing' : 'text'} editor={editor} id={item.id} text={item.text} editing={editing === item.id} onDone={() => setEditing(null)} />
        </div>
      ))}
      {active && !readOnly && !thread.meta.done && (
        <form
          className="mt-2 flex items-end gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (!reply.trim()) return
            editor.replyToComment(thread.id, reply.trim())
            setReply('')
          }}
        >
          <Input value={reply} onChange={(event) => setReply(event.target.value)} placeholder={ui("Reply")} aria-label={ui("Reply")} className="h-8" />
          <Button type="submit" size="icon" variant="ghost" aria-label={ui("Send reply")} title={ui("Send reply")} disabled={!reply.trim()}>
            <MessageCircleReply className="size-4" />
          </Button>
        </form>
      )}
    </article>
  )
}

/**
 * The comments panel: a box for a new comment on the selection (Insert ▸ Comment, the toolbar's
 * Comment, and Cmd/Ctrl+Alt+M focus it, as in Docs), then the threads in reading order. A click
 * on a thread shows its text in the document.
 */
export function CommentsPanel({ editor, onClose, user, draftRequest = 0, onDraftCancel }: {
  editor: DocxEditor
  onClose: () => void
  /** The viewer's name: their own comments can be edited. */
  user?: string
  /** Changes each time a new comment is asked for; the box takes focus. */
  draftRequest?: number
  /** Escape in the new comment box; the document should take focus back. */
  onDraftCancel?: () => void
}) {
  const threads = useEditorValue(editor, () => editor.comments())
  const active = useEditorValue(editor, () => editor.activeComment)
  const [draft, setDraft] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const draftBox = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const visible = threads.filter((thread) => showResolved || !thread.meta.done)
  const canComment = editor.canComment
  // As the panel commits, so keys typed right after the request land in the box.
  useLayoutEffect(() => {
    if (!draftRequest) return
    draftBox.current?.focus({ preventScroll: true })
    draftBox.current?.scrollIntoView({ block: 'nearest' })
  }, [draftRequest])
  // A thread opened from the document (a click, the context menu) comes into view.
  useEffect(() => {
    if (active) list.current?.querySelector(`[data-comment="${CSS.escape(active)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const submit = () => {
    if (!draft.trim()) return
    editor.addComment(draft.trim())
    setDraft('')
  }
  return (
    <PanelFrame title={ui("Comments")} onClose={onClose}>
      <div ref={list} className="flex flex-col gap-2 p-3" data-docx-comments>
        {canComment && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <Textarea
              ref={draftBox}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => commentKeys(event, {
                submit,
                cancel: () => {
                  setDraft('')
                  onDraftCancel?.()
                },
              })}
              placeholder={ui("Comment on the selection")}
              aria-label={ui("New comment")}
              rows={2}
              data-docx-comment-draft=""
            />
            <Button type="submit" size="sm" disabled={!draft.trim()} className="self-end">{ui("Comment")}</Button>
          </form>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
          {ui("Show resolved")}
        </label>
        {visible.map((thread) => <CommentCard key={thread.id} editor={editor} thread={thread} active={active === thread.id} user={user} />)}
        {!visible.length && <p className="py-4 text-center text-sm text-muted-foreground">{ui("No comments")}</p>}
      </div>
    </PanelFrame>
  )
}

const KIND_LABELS = (): Record<Revision['kind'], string> => ({
  insert: ui("Inserted"),
  delete: ui("Deleted"),
  moveFrom: ui("Moved from"),
  moveTo: ui("Moved to"),
  format: ui("Formatted"),
  paragraphInsert: ui("Paragraph inserted"),
  paragraphDelete: ui("Paragraph deleted"),
  rowInsert: ui("Row inserted"),
  rowDelete: ui("Row deleted"),
  cellInsert: ui("Inserted"),
  cellDelete: ui("Deleted"),
  cellMerge: ui("Formatted"),
  paragraphFormat: ui("Paragraph formatted"),
})

/** Tracked changes: Accept or Reject all, Previous and Next (Word's Review tab), and a card per change. */
export function ReviewPanel({ editor, onClose, showMarkup, onShowMarkupChange }: {
  editor: DocxEditor
  onClose: () => void
  showMarkup: boolean
  onShowMarkupChange: (show: boolean) => void
}) {
  const revisions = useEditorValue(editor, () => editor.revisions())
  const state = useEditorValue(editor, () => editor.state())
  const labels = KIND_LABELS()
  const stories: Record<string, string> = { header: ui("Header"), footer: ui("Footer"), footnote: ui("Footnote"), endnote: ui("Endnote") }
  const readOnly = state.readOnly
  return (
    <PanelFrame title={ui("Tracked changes")} onClose={onClose}>
      <div className="flex flex-col gap-2 p-3" data-docx-review>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="outline" disabled={readOnly || !revisions.length} onClick={() => editor.acceptAll()}>{ui("Accept all")}</Button>
          <Button size="sm" variant="outline" disabled={readOnly || !revisions.length} onClick={() => editor.rejectAll()}>{ui("Reject all")}</Button>
          <div className="ml-auto flex items-center">
            <ToolbarButton label={ui("Previous change")} disabled={!revisions.length} onClick={() => editor.nextRevision(-1)}><ChevronUp className="size-4" /></ToolbarButton>
            <ToolbarButton label={ui("Next change")} disabled={!revisions.length} onClick={() => editor.nextRevision(1)}><ChevronDown className="size-4" /></ToolbarButton>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showMarkup} onChange={(event) => onShowMarkupChange(event.target.checked)} />
          {ui("Show markup")}
        </label>
        {revisions.map((revision) => (
          <article key={revision.key} className="rounded-lg border bg-card p-2 text-sm" data-revision={revision.kind}>
            <button type="button" className="block w-full cursor-pointer text-left" onClick={() => editor.goTo(revision.from - 1, revision.storyId)}>
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{labels[revision.kind]}</span>
                {revision.storyId && <span className="text-xs text-muted-foreground">{stories[revision.storyId.split(':')[0]!]}</span>}
                <span className="truncate text-xs text-muted-foreground">{revision.author}</span>
              </div>
              {revision.date && <div className="text-xs text-muted-foreground" data-revision-date="">{formatDate(revision.date)}</div>}
              {revision.text && <p className={cn('mt-1 line-clamp-3 break-words', revision.kind === 'delete' || revision.kind === 'moveFrom' ? 'text-red-700 line-through dark:text-red-400' : 'text-green-700 dark:text-green-400')}>{revision.text}</p>}
            </button>
            {!readOnly && (
              <div className="mt-1 flex justify-end gap-0.5">
                <ToolbarButton label={ui("Accept")} onClick={() => editor.resolveRevisions([revision], 'accept')}><Check className="size-4" /></ToolbarButton>
                <ToolbarButton label={ui("Reject")} onClick={() => editor.resolveRevisions([revision], 'reject')}><X className="size-4" /></ToolbarButton>
              </div>
            )}
          </article>
        ))}
        {!revisions.length && <p className="py-4 text-center text-sm text-muted-foreground">{ui("No tracked changes")}</p>}
      </div>
    </PanelFrame>
  )
}

export function FindBar({ editor, replaceOpen, onClose }: { editor: DocxEditor; replaceOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [showReplace, setShowReplace] = useState(replaceOpen)
  const options = useMemo(() => ({ matchCase, wholeWord }), [matchCase, wholeWord])
  const status = useEditorValue(editor, () => editor.findState())
  const story = useEditorValue(editor, () => editor.editingStory)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { setShowReplace((open) => open || replaceOpen) }, [replaceOpen])
  useEffect(() => {
    editor.find(query, options)
  }, [editor, query, options, story])
  useEffect(() => () => editor.clearFind(), [editor])
  const close = () => {
    editor.clearFind()
    onClose()
    editor.focus()
  }
  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-background px-3 py-1.5" role="search" data-docx-find onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
      <Input
        ref={input}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            editor.findStep(event.shiftKey ? -1 : 1)
          }
        }}
        placeholder={ui("Find in document")}
        aria-label={ui("Find in document")}
        className="h-8 w-56"
      />
      <span className="min-w-16 text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {query ? ui("{{index}} of {{count}}", { index: status.count ? status.index + 1 : 0, count: status.count }) : ''}
      </span>
      <ToolbarButton label={ui("Previous match")} onClick={() => editor.findStep(-1)}><ArrowUp className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Next match")} onClick={() => editor.findStep(1)}><ArrowDown className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Match case")} active={matchCase} onClick={() => setMatchCase((value) => !value)}><CaseSensitive className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Whole words")} active={wholeWord} onClick={() => setWholeWord((value) => !value)}><WholeWord className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Replace")} active={showReplace} onClick={() => setShowReplace((value) => !value)}><Replace className="size-4" /></ToolbarButton>
      {showReplace && (
        <>
          <Input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder={ui("Replace with")} aria-label={ui("Replace with")} className="h-8 w-48" />
          <Button size="sm" variant="outline" disabled={!status.count || editor.readOnly} onClick={() => editor.replace(replacement, query, options)}>{ui("Replace")}</Button>
          <Button size="sm" variant="outline" disabled={!status.count || editor.readOnly} onClick={() => editor.replaceAll(replacement, query, options)}>{ui("Replace all")}</Button>
        </>
      )}
      <ToolbarButton label={ui("Close")} onClick={close} className="ml-auto"><X className="size-4" /></ToolbarButton>
    </div>
  )
}

/**
 * Word's status bar: the cursor's page ("Page 2 of 5", print layout), the word count (with the
 * selection's) when shown, the layouts, and the zoom.
 */
export function StatusBar({ editor, state, showWordCount, onWordCount, zoom }: {
  editor: DocxEditor
  /** The view's formatting state, read once a frame. */
  state: DocxFormattingState
  showWordCount: boolean
  /** Opens Tools ▸ Word count. */
  onWordCount: () => void
  zoom: { fitted: boolean; onFit?: () => void; onZoom: (zoom: number) => void }
}) {
  // Both walk the document or measure the layout, so they refresh a few times a second while typing.
  const page = useEditorValue(editor, () => editor.currentPage(), 150)
  // The main text's words (also while a header or note is open); an empty selection counts none.
  const words = useEditorValue(editor, () => ({ document: editor.wordCount('body').words, selected: editor.wordCount('selection').words || null }), 250)
  const print = state.layout === 'print'
  return (
    <footer className="@container flex h-8 shrink-0 items-center gap-3 overflow-hidden border-t bg-background px-3 text-xs whitespace-nowrap text-muted-foreground" data-docx-status>
      {print && (
        <span data-docx-pages>
          {page ? ui("Page {{page}} of {{count}}", { page: page.index.toLocaleString(activeLocale()), count: page.count.toLocaleString(activeLocale()) }) : state.pages === 1 ? ui("1 page") : ui("{{count}} pages", { count: state.pages })}
        </span>
      )}
      {showWordCount && (
        <button type="button" title={ui("Word count")} onClick={onWordCount} className="min-w-0 cursor-pointer truncate rounded px-1 py-0.5 hover:bg-accent hover:text-foreground" data-docx-words>
          {wordCountLabel(words.document, words.selected)}
        </button>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <div className="hidden items-center gap-1 @md:flex">
          <button type="button" className={cn('cursor-pointer rounded px-1.5 py-0.5 hover:bg-accent', print && 'text-foreground')} onClick={() => editor.setLayout('print')}>{ui("Print layout")}</button>
          <button type="button" className={cn('cursor-pointer rounded px-1.5 py-0.5 hover:bg-accent', !print && 'text-foreground')} onClick={() => editor.setLayout('web')}>{ui("Web layout")}</button>
          <span className="mx-1 h-4 w-px bg-border" />
        </div>
        <ZoomControl
          compact
          zoom={state.zoom}
          onZoom={zoom.onZoom}
          fitted={print && zoom.fitted}
          onFit={print ? zoom.onFit : undefined}
          onDone={() => editor.focus()}
          valueProps={{ 'data-docx-zoom': '' }}
        />
      </div>
    </footer>
  )
}

/**
 * The slim bar Docs and Word show while a header or footer is open: which one it is, Different
 * first page, a page number at the cursor, Remove, and Close (Esc).
 */
export function HeaderFooterBar({ editor, storyId, editable }: { editor: DocxEditor; storyId: string; editable: boolean }) {
  // Read afresh on each render (the view re-renders as the editor updates, and this bar after its
  // own change); a collaborator's change to the setting re-renders it too.
  useEditorValue(editor, () => editor.headerFooter().differentFirstPage, 120)
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const info = editor.headerFooter()
  const kind: HeaderFooterKind = storyId.startsWith('header:') ? 'header' : 'footer'
  const type = (['first', 'even', 'default'] as const).find((candidate) => info[kind][candidate] === storyId) ?? 'default'
  const name = headerFooterName(kind, type, info.differentOddEven)
  const keep = (event: React.MouseEvent) => event.preventDefault()
  const button = 'flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div role="toolbar" aria-label={name} className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b bg-muted/40 px-3 text-sm [scrollbar-width:none]" data-docx-header-footer-bar={kind}>
      <span className="mr-2 shrink-0 font-medium">{name}</span>
      <label className="mr-1 flex shrink-0 cursor-pointer items-center gap-2 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
        <input
          type="checkbox"
          checked={info.differentFirstPage}
          disabled={!editable}
          onChange={(event) => {
            editor.setDifferentFirstPage(event.target.checked)
            rerender()
            editor.focus()
          }}
          className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
        />
        {ui("Different first page")}
      </label>
      <button type="button" className={button} disabled={!editable} onMouseDown={keep} onClick={() => editor.insertPageNumber({})}>
        <Hash className="size-3.5" />
        {ui("Page number")}
      </button>
      <button type="button" className={button} disabled={!editable} onMouseDown={keep} onClick={() => editor.removeHeaderFooter(kind, type)}>
        <Trash2 className="size-3.5" />
        {kind === 'header' ? ui("Remove header") : ui("Remove footer")}
      </button>
      <button type="button" className={cn(button, 'ml-auto')} aria-label={kind === 'header' ? ui("Close header") : ui("Close footer")} title={ui("Close (Esc)")} onMouseDown={keep} onClick={() => editor.closeStoryEditor()}>
        <X className="size-3.5" />
        {ui("Close")}
      </button>
    </div>
  )
}
