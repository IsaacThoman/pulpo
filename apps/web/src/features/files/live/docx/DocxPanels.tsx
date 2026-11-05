import { useEffect, useMemo, useRef, useState } from 'react'
import type { CommentThread, DocxEditor, Revision } from '@pulpo/client-core/office/docx/view'
import { ArrowDown, ArrowUp, CaseSensitive, Check, MessageCircleReply, Replace, Trash2, WholeWord, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { ToolbarButton } from './DocxToolbar'

/** Re-reads a value from the editor whenever it updates (and on layout). */
function useEditorValue<T>(editor: DocxEditor, read: () => T): T {
  const [value, setValue] = useState(read)
  const reader = useRef(read)
  reader.current = read
  useEffect(() => {
    let frame = 0
    const refresh = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setValue(reader.current())
      })
    }
    const stops = [editor.on('update', refresh), editor.on('layout', refresh), editor.on('activeComment', refresh)]
    refresh()
    return () => {
      cancelAnimationFrame(frame)
      for (const stop of stops) stop()
    }
  }, [editor])
  return value
}

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
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function CommentCard({ editor, thread, active }: { editor: DocxEditor; thread: CommentThread; active: boolean }) {
  const [reply, setReply] = useState('')
  const readOnly = !editor.canComment
  return (
    <article
      data-comment={thread.id}
      onClick={() => editor.setActiveComment(thread.id)}
      className={cn('rounded-lg border bg-card p-3 text-sm shadow-xs transition-colors', active && 'border-primary', thread.meta.done && 'opacity-70')}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{thread.meta.author ?? ui("Unknown author")}</div>
          <div className="text-xs text-muted-foreground">{formatDate(thread.meta.date)}</div>
        </div>
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
      <p className="mt-1 whitespace-pre-wrap break-words">{thread.text}</p>
      {thread.replies.map((item) => (
        <div key={item.id} className="mt-2 border-t pt-2">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium">{item.meta.author ?? ui("Unknown author")}</span>
            <span className="text-xs text-muted-foreground">{formatDate(item.meta.date)}</span>
          </div>
          <p className="whitespace-pre-wrap break-words">{item.text}</p>
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

export function CommentsPanel({ editor, onClose }: { editor: DocxEditor; onClose: () => void }) {
  const threads = useEditorValue(editor, () => editor.comments())
  const active = useEditorValue(editor, () => editor.activeComment)
  const [draft, setDraft] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const visible = threads.filter((thread) => showResolved || !thread.meta.done)
  const canComment = editor.canComment
  return (
    <PanelFrame title={ui("Comments")} onClose={onClose}>
      <div className="flex flex-col gap-2 p-3" data-docx-comments>
        {canComment && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!draft.trim()) return
              editor.addComment(draft.trim())
              setDraft('')
            }}
          >
            <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={ui("Comment on the selection")} aria-label={ui("New comment")} rows={2} />
            <Button type="submit" size="sm" disabled={!draft.trim()} className="self-end">{ui("Comment")}</Button>
          </form>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
          {ui("Show resolved")}
        </label>
        {visible.map((thread) => <CommentCard key={thread.id} editor={editor} thread={thread} active={active === thread.id} />)}
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
  paragraphFormat: ui("Paragraph formatted"),
})

export function ReviewPanel({ editor, onClose }: { editor: DocxEditor; onClose: () => void }) {
  const revisions = useEditorValue(editor, () => editor.revisions())
  const state = useEditorValue(editor, () => editor.state())
  const [showMarkup, setShowMarkup] = useState(true)
  const labels = KIND_LABELS()
  const stories: Record<string, string> = { header: ui("Header"), footer: ui("Footer"), footnote: ui("Footnote"), endnote: ui("Endnote") }
  const readOnly = state.readOnly
  return (
    <PanelFrame title={ui("Tracked changes")} onClose={onClose}>
      <div className="flex flex-col gap-2 p-3" data-docx-review>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" disabled={readOnly || !revisions.length} onClick={() => editor.acceptAll()}>{ui("Accept all")}</Button>
          <Button size="sm" variant="outline" disabled={readOnly || !revisions.length} onClick={() => editor.rejectAll()}>{ui("Reject all")}</Button>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showMarkup} onChange={(event) => { setShowMarkup(event.target.checked); editor.setShowMarkup(event.target.checked) }} />
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

export function StatusBar({ editor }: { editor: DocxEditor }) {
  const state = useEditorValue(editor, () => editor.state())
  const words = useEditorValue(editor, () => editor.wordCount())
  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t bg-background px-3 text-xs text-muted-foreground" data-docx-status>
      {state.layout === 'print' && <span data-docx-pages>{state.pages === 1 ? ui("1 page") : ui("{{count}} pages", { count: state.pages })}</span>}
      <span data-docx-words>{ui("{{count}} words", { count: words.words.toLocaleString() })}</span>
      <span>{ui("{{count}} characters", { count: words.charactersWithSpaces.toLocaleString() })}</span>
      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={cn('cursor-pointer rounded px-1.5 py-0.5 hover:bg-accent', state.layout === 'print' && 'text-foreground')} onClick={() => editor.setLayout('print')}>{ui("Print layout")}</button>
        <button type="button" className={cn('cursor-pointer rounded px-1.5 py-0.5 hover:bg-accent', state.layout === 'web' && 'text-foreground')} onClick={() => editor.setLayout('web')}>{ui("Web layout")}</button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" aria-label={ui("Zoom out")} title={ui("Zoom out")} className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-accent" onClick={() => editor.setZoom(Math.round((state.zoom - 0.1) * 10) / 10)}>−</button>
        <span className="w-10 text-center tabular-nums" data-docx-zoom>{Math.round(state.zoom * 100)}%</span>
        <button type="button" aria-label={ui("Zoom in")} title={ui("Zoom in")} className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-accent" onClick={() => editor.setZoom(Math.round((state.zoom + 0.1) * 10) / 10)}>+</button>
      </div>
    </footer>
  )
}
