import { useEffect, useRef, type ReactNode } from 'react'
import { createEditorExtensions, formattingState, runFormatCommand, type FormatCommand } from '@pulpo/client-core/doc-editor'
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
import { revealSuggestion } from './suggestion-layout'
import { SuggestionReviewKeys, useSuggestionReview } from './suggestion-review'
import { SuggestionBar, SuggestionCard } from './SuggestionReview'
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

/** Toolbar buttons that turn a format on and off, announced as pressed or not. */
const TOGGLE_COMMANDS = new Set<FormatCommand>([
  'heading1', 'heading2', 'heading3', 'bold', 'italic', 'strike', 'code', 'link',
  'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock',
])

function DocToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({ editor, selector: ({ editor: current }) => formattingState(current) })
  const run = (command: FormatCommand) => runFormatCommand(editor, command)
  const setLink = () => {
    const href = window.prompt(ui("Link URL"), state.linkHref ?? 'https://')
    if (href !== null) runFormatCommand(editor, 'link', { href })
  }
  const button = (command: FormatCommand, label: string, icon: ReactNode, onClick = () => { run(command) }) => (
    <ToolbarButton
      label={label}
      // Actions (undo, insert a table, …) are not toggles; only formats report being on.
      active={TOGGLE_COMMANDS.has(command) ? state.active.includes(command) : undefined}
      disabled={state.disabled.includes(command)}
      onClick={onClick}
    >
      {icon}
    </ToolbarButton>
  )
  return (
    <div role="toolbar" aria-label={ui("Formatting")} className="flex flex-wrap items-center gap-0.5">
      {button('undo', ui("Undo"), <Undo2 className="size-4" />)}
      {button('redo', ui("Redo"), <Redo2 className="size-4" />)}
      <span className="mx-1 h-5 w-px bg-border" />
      {button('heading1', ui("Heading 1"), <Heading1 className="size-4" />)}
      {button('heading2', ui("Heading 2"), <Heading2 className="size-4" />)}
      {button('heading3', ui("Heading 3"), <Heading3 className="size-4" />)}
      <span className="mx-1 h-5 w-px bg-border" />
      {button('bold', ui("Bold"), <Bold className="size-4" />)}
      {button('italic', ui("Italic"), <Italic className="size-4" />)}
      {button('strike', ui("Strikethrough"), <Strikethrough className="size-4" />)}
      {button('code', ui("Inline code"), <Code className="size-4" />)}
      {button('link', ui("Link"), <Link2 className="size-4" />, setLink)}
      <span className="mx-1 h-5 w-px bg-border" />
      {button('bulletList', ui("Bulleted list"), <List className="size-4" />)}
      {button('orderedList', ui("Numbered list"), <ListOrdered className="size-4" />)}
      {button('taskList', ui("Checklist"), <ListChecks className="size-4" />)}
      {button('blockquote', ui("Quote"), <Quote className="size-4" />)}
      {button('codeBlock', ui("Code block"), <SquareCode className="size-4" />)}
      {button('table', ui("Table"), <Table className="size-4" />)}
      {button('divider', ui("Divider"), <Minus className="size-4" />)}
    </div>
  )
}

/** CSS for the hunk being looked at; marks and blocks carry its id, so one rule covers every piece. */
function activeHunkStyle(id: string): string {
  const selector = `.pulpo-doc-editor [data-suggestion-id="${id.replace(/[^\w-]/g, '')}"]`
  return `${selector} { outline: 1.5px solid var(--pulpo-suggestion-focus); outline-offset: 1px; border-radius: 2px; }`
}

function DocEditorView({ editor, editable, width, toolbarSlot, onSuggestionsResolved }: {
  editor: Editor
  /** Viewers who cannot edit still see suggestions, without the actions. */
  editable: boolean
  width: 'narrow' | 'wide' | 'fill'
  toolbarSlot?: ReactNode
  onSuggestionsResolved?: () => void
}) {
  const review = useSuggestionReview(editor, onSuggestionsResolved)
  const header = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const active = review.active
  const step = (direction: 1 | -1) => {
    const target = review.go(direction)
    if (target) revealSuggestion(editor.view, target, header.current)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={review.onKeyDown}>
      <div ref={header} className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-1.5 backdrop-blur sm:px-6">
        <div className="min-w-0 flex-1 overflow-x-auto"><DocToolbar editor={editor} /></div>
        {toolbarSlot}
        {review.hunks.length > 0 && (
          <div className="basis-full border-t pt-1.5">
            <SuggestionBar
              hunks={review.hunks}
              active={active}
              editable={editable}
              onStep={step}
              onResolveAll={(action) => review.resolve(() => true, action)}
            />
          </div>
        )}
      </div>
      {/* Match the chat column so documents read at the same width as conversations. */}
      <div className={cn(
        'mx-auto w-full flex-1',
        width === 'fill' ? 'px-5 py-5' : 'px-4 py-8 sm:px-6',
        width === 'wide' && 'max-w-[min(100%,90rem)]',
        width === 'narrow' && 'max-w-5xl',
      )}>
        {/* Its own stacking context, so the suggestion card stays under the sticky toolbar. */}
        <div ref={content} className="relative isolate">
          <EditorContent editor={editor} />
          {active && <style>{activeHunkStyle(active.id)}</style>}
          {active && (
            <SuggestionCard
              key={active.id}
              editor={editor}
              hunk={active}
              anchor={review.anchor}
              editable={editable}
              container={content}
              onResolve={(action) => review.resolve((ref) => ref.id === active.id, action)}
              onPointerEnter={review.keepHover}
              onPointerLeave={review.releaseHover}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function DocEditor({ session, editable, width = 'narrow', toolbarSlot, onSuggestionsResolved }: {
  session: DocSession
  editable: boolean
  /** `narrow` and `wide` follow the chat width preference (64rem or 90rem); `fill` uses the side panel's width. */
  width?: 'narrow' | 'wide' | 'fill'
  /** Rendered next to the toolbar, e.g. presence and sync status. */
  toolbarSlot?: ReactNode
  /** Called after this editor accepted or rejected suggestions, e.g. to refresh replies' change lists. */
  onSuggestionsResolved?: () => void
}) {
  const editor = useEditor({
    extensions: [
      ...createEditorExtensions({
        doc: session.doc,
        awareness: session.provider.awareness,
        user: { name: sessionLabel(), color: sessionColor(session.doc.clientID) },
        placeholder: ui("Start writing…"),
      }),
      SuggestionReviewKeys,
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
  return <DocEditorView editor={editor} editable={editable} width={width} toolbarSlot={toolbarSlot} onSuggestionsResolved={onSuggestionsResolved} />
}
