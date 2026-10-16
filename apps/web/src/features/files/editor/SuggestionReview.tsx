import { useLayoutEffect, useState, type RefObject } from 'react'
import type { SuggestionAction, SuggestionHunk } from '@pulpo/client-core/doc-schema'
import type { Editor } from '@tiptap/react'
import { Check, ChevronDown, ChevronUp, MessageSquareDiff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ui, uit } from '@/i18n/ui'
import { describeHunk } from './suggestion-review'

/**
 * Shown while the document has suggestions: how many, stepping through them, and resolving all
 * of them at once (for whoever can edit).
 */
export function SuggestionBar({ hunks, active, editable, onStep, onResolveAll }: {
  hunks: readonly SuggestionHunk[]
  active: SuggestionHunk | null
  editable: boolean
  onStep: (direction: 1 | -1) => void
  onResolveAll: (action: SuggestionAction) => void
}) {
  if (!hunks.length) return null
  const index = active ? hunks.findIndex((hunk) => hunk.id === active.id) : -1
  return (
    <div role="toolbar" aria-label={ui("Suggestions")} className="flex w-full flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <MessageSquareDiff className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
      <span className="mr-1 tabular-nums" aria-live="polite">
        {index >= 0
          ? uit`Suggestion ${index + 1} of ${hunks.length}`
          : hunks.length === 1 ? ui("1 suggestion") : uit`${hunks.length} suggestions`}
      </span>
      <Button variant="ghost" size="icon-sm" className="size-6" aria-label={ui("Previous suggestion")} title={ui("Previous suggestion")} onMouseDown={(event) => event.preventDefault()} onClick={() => onStep(-1)}><ChevronUp /></Button>
      <Button variant="ghost" size="icon-sm" className="size-6" aria-label={ui("Next suggestion")} title={ui("Next suggestion")} onMouseDown={(event) => event.preventDefault()} onClick={() => onStep(1)}><ChevronDown /></Button>
      {editable && (
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onMouseDown={(event) => event.preventDefault()} onClick={() => onResolveAll('accept')}>
            <Check className="text-emerald-600 dark:text-emerald-400" /> {ui("Accept all")}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onMouseDown={(event) => event.preventDefault()} onClick={() => onResolveAll('reject')}>
            <X className="text-red-600 dark:text-red-400" /> {ui("Reject all")}
          </Button>
        </span>
      )}
    </div>
  )
}

const CARD_WIDTH = 288

/**
 * A small card under the suggestion being looked at: what it changes, and Accept / Reject for
 * whoever can edit. Positioned inside `container`, which wraps the editor and scrolls with it.
 */
export function SuggestionCard({ editor, hunk, editable, container, onResolve, onPointerEnter, onPointerLeave }: {
  editor: Editor
  hunk: SuggestionHunk
  editable: boolean
  container: RefObject<HTMLElement | null>
  onResolve: (action: SuggestionAction) => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const box = container.current?.getBoundingClientRect()
      if (!box) return
      try {
        const start = editor.view.coordsAtPos(hunk.from, 1)
        const end = editor.view.coordsAtPos(hunk.to, -1)
        const left = Math.max(0, Math.min(start.left - box.left, box.width - CARD_WIDTH))
        setPosition({ top: Math.max(start.bottom, end.bottom) - box.top + 6, left })
      } catch {
        // The hunk is gone from the view while the document updates.
        setPosition(null)
      }
    }
    place()
    editor.on('update', place)
    // The side panel can change width without the window resizing.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (container.current) observer?.observe(container.current)
    return () => {
      editor.off('update', place)
      observer?.disconnect()
    }
  }, [container, editor, hunk.from, hunk.to])

  if (!position) return null
  return (
    <div
      role="dialog"
      aria-label={ui("Suggestion")}
      data-suggestion-card={hunk.id}
      className="absolute z-20 flex items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
      style={{ top: position.top, left: position.left, maxWidth: CARD_WIDTH }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className="min-w-0 flex-1 break-words">{describeHunk(hunk)}</span>
      {editable && (
        <span className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" className="size-7 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400" aria-label={ui("Accept suggestion")} title={ui("Accept suggestion")} onClick={() => onResolve('accept')}><Check /></Button>
          <Button variant="ghost" size="icon-sm" className="size-7 text-red-600 hover:text-red-700 dark:text-red-400" aria-label={ui("Reject suggestion")} title={ui("Reject suggestion")} onClick={() => onResolve('reject')}><X /></Button>
        </span>
      )}
    </div>
  )
}
