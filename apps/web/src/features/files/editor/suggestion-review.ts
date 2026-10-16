import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { listSuggestions, resolveSuggestions, type SuggestionAction, type SuggestionHunk, type SuggestionRef } from '@pulpo/client-core/doc-schema'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Selection, type EditorState } from '@tiptap/pm/state'
import { useEditorState, type Editor } from '@tiptap/react'
import { ui, uit } from '@/i18n/ui'
import { SUGGESTION_REVIEW_META } from './suggestion-typing'

const hunkCache = new WeakMap<ProseMirrorNode, SuggestionHunk[]>()

/** A document's hunks. Documents are immutable, so selection-only updates reuse the list. */
export function docSuggestions(doc: ProseMirrorNode): SuggestionHunk[] {
  let hunks = hunkCache.get(doc)
  if (!hunks) {
    hunks = listSuggestions(doc)
    hunkCache.set(doc, hunks)
  }
  return hunks
}

function innermost(hunks: readonly SuggestionHunk[]): SuggestionHunk | null {
  return hunks.reduce<SuggestionHunk | null>((best, hunk) => !best || hunk.to - hunk.from < best.to - best.from ? hunk : best, null)
}

/**
 * The hunk the cursor is in or touching: the innermost when one sits inside another (text
 * suggested inside a suggested block), and between two, the one starting there.
 */
export function hunkAt(hunks: readonly SuggestionHunk[], pos: number): SuggestionHunk | null {
  return innermost(hunks.filter((hunk) => hunk.from <= pos && pos < hunk.to)) ?? innermost(hunks.filter((hunk) => hunk.to === pos))
}

/** The next or previous hunk from the active one (or the cursor), wrapping around. */
export function adjacentHunk(hunks: readonly SuggestionHunk[], pos: number, activeId: string | null, direction: 1 | -1): SuggestionHunk | null {
  if (!hunks.length) return null
  const active = activeId ? hunks.findIndex((hunk) => hunk.id === activeId) : -1
  if (active >= 0) return hunks[(active + direction + hunks.length) % hunks.length]!
  if (direction === 1) return hunks.find((hunk) => hunk.from > pos) ?? hunks[0]!
  return hunks.findLast((hunk) => hunk.to < pos) ?? hunks.at(-1)!
}

const QUOTE_LENGTH = 48

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > QUOTE_LENGTH ? `${flat.slice(0, QUOTE_LENGTH - 1)}…` : flat
}

/** What a hunk does, in a few words: "Replace “a” with “b”". */
export function describeHunk(hunk: Pick<SuggestionHunk, 'inserted' | 'deleted'>): string {
  const inserted = excerpt(hunk.inserted)
  const deleted = excerpt(hunk.deleted)
  if (inserted && deleted) return uit`Replace “${deleted}” with “${inserted}”`
  if (inserted) return uit`Add “${inserted}”`
  if (deleted) return uit`Delete “${deleted}”`
  if (hunk.inserted) return ui("Add a space or line break")
  if (hunk.deleted) return ui("Delete a space or line break")
  return ui("Change the layout")
}

/**
 * How long the card stays after the pointer leaves its suggestion, for plain text or another
 * suggestion, so it can be reached across whatever lies between.
 */
const HOVER_GRACE_MS = 250

/** The hunk under the pointer, and the hunk the cursor was in when the pointer got there. */
type Hover = { id: string; cursorId: string | null }

/**
 * The document's suggestions and the one being looked at: the hunk under the pointer, else the
 * one at the cursor. Accepting and rejecting go through the editor so its undo covers them.
 */
export function useSuggestionReview(editor: Editor, onResolved?: () => void) {
  // The hunk last stepped to, and where that put the cursor. While the cursor stays there that
  // hunk is the one looked at, even when the position also falls inside or next to another.
  const stepped = useRef<{ id: string; pos: number } | null>(null)
  const cursorHunkId = useCallback((state: EditorState) => {
    const list = docSuggestions(state.doc)
    const pos = state.selection.from
    const step = stepped.current
    return step?.pos === pos && list.some((hunk) => hunk.id === step.id) ? step.id : hunkAt(list, pos)?.id ?? null
  }, [])
  const { hunks, cursorId } = useEditorState({
    editor,
    selector: ({ editor: current }) => ({ hunks: docSuggestions(current.state.doc), cursorId: cursorHunkId(current.state) }),
    // The list only changes with the document, and is then a new array.
    equalityFn: (a, b) => b !== null && a.hunks === b.hunks && a.cursorId === b.cursorId,
  })
  const [hover, setHover] = useState<Hover | null>(null)
  const previousHunks = useRef(hunks.map((hunk) => hunk.id).join(','))
  const hoverTimer = useRef<number | undefined>(undefined)
  // The hunk whose card is showing, for the pointer handlers.
  const shownId = useRef<string | null>(null)

  useEffect(() => {
    const ids = hunks.map((hunk) => hunk.id).join(',')
    if (previousHunks.current === ids) return
    previousHunks.current = ids
    // Undo/redo and typing can also remove or restore suggestions, without using a review button.
    onResolved?.()
  }, [hunks, onResolved])

  const keepHover = useCallback(() => window.clearTimeout(hoverTimer.current), [])
  /** Hovers `next`, or nothing, unless the pointer gets back to the card or its suggestion first. */
  const hoverSoon = useCallback((next: Hover | null) => {
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHover(next), HOVER_GRACE_MS)
  }, [])
  const releaseHover = useCallback(() => hoverSoon(null), [hoverSoon])
  const clearHover = () => {
    window.clearTimeout(hoverTimer.current)
    setHover(null)
  }

  useEffect(() => {
    const dom = editor.view.dom
    const over = (event: MouseEvent) => {
      const id = (event.target as Element | null)?.closest?.('[data-suggestion-id]')?.getAttribute('data-suggestion-id') ?? null
      if (id && id === shownId.current) {
        keepHover()
        return
      }
      const next = id ? { id, cursorId: cursorHunkId(editor.state) } : null
      if (next && !shownId.current) {
        keepHover()
        // Before React shows the card, so the pointer moving straight on is handled as leaving it.
        shownId.current = next.id
        setHover(next)
      } else {
        // On the way to the card the pointer may cross other suggestions, or the block suggestion
        // around an inline one; they only take the card over once the pointer stays.
        hoverSoon(next)
      }
    }
    // Moving onto the card keeps the suggestion. React runs the card's onPointerEnter before this
    // mouseleave, so starting the timer here would hide the card under the pointer.
    const leave = (event: MouseEvent) => {
      if (!(event.relatedTarget as Element | null)?.closest?.('[data-suggestion-card]')) releaseHover()
    }
    dom.addEventListener('mouseover', over)
    dom.addEventListener('mouseleave', leave)
    return () => {
      dom.removeEventListener('mouseover', over)
      dom.removeEventListener('mouseleave', leave)
      window.clearTimeout(hoverTimer.current)
    }
  }, [editor, cursorHunkId, keepHover, hoverSoon, releaseHover])

  // The pointer's suggestion, until the cursor moves into another one, as tapping it on a touch
  // screen does; that is the newer of the two.
  const hovered = hover && (cursorId === null || cursorId === hover.cursorId || cursorId === hover.id)
    ? hunks.find((hunk) => hunk.id === hover.id)
    : undefined
  const active = hovered ?? hunks.find((hunk) => hunk.id === cursorId) ?? null
  useLayoutEffect(() => {
    shownId.current = active?.id ?? null
  })

  const go = (direction: 1 | -1) => {
    const target = adjacentHunk(hunks, editor.state.selection.from, active?.id ?? null, direction)
    if (!target) return
    clearHover()
    const { tr } = editor.state
    const selection = Selection.near(tr.doc.resolve(target.from))
    stepped.current = { id: target.id, pos: selection.from }
    editor.view.dispatch(tr.setSelection(selection).scrollIntoView())
    editor.view.focus()
  }

  const resolve = (match: (ref: SuggestionRef) => boolean, action: SuggestionAction) => {
    const tr = resolveSuggestions(editor.state.tr.setMeta(SUGGESTION_REVIEW_META, true), match, action)
    if (!tr.docChanged) return
    clearHover()
    editor.view.dispatch(tr)
  }

  return { hunks, active, go, resolve, keepHover, releaseHover }
}
