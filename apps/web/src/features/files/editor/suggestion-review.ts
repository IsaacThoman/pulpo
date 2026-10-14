import { useCallback, useEffect, useRef, useState } from 'react'
import { listSuggestions, resolveSuggestions, type SuggestionAction, type SuggestionHunk, type SuggestionRef } from '@pulpo/client-core/doc-schema'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'
import { useEditorState, type Editor } from '@tiptap/react'
import { ui, uit } from '@/i18n/ui'

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

/** The hunk the cursor is in or touching; between two, the one starting there. */
export function hunkAt(hunks: readonly SuggestionHunk[], pos: number): SuggestionHunk | null {
  return hunks.find((hunk) => hunk.from <= pos && pos < hunk.to) ?? hunks.find((hunk) => hunk.to === pos) ?? null
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

/** How long the card stays after the pointer leaves a suggestion, so it can be reached. */
const HOVER_GRACE_MS = 250

/**
 * The document's suggestions and the one being looked at: the hunk under the pointer, else the
 * one at the cursor. Accepting and rejecting go through the editor so its undo covers them.
 */
export function useSuggestionReview(editor: Editor, onResolved?: () => void) {
  const { hunks, cursorId } = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const list = docSuggestions(current.state.doc)
      return { hunks: list, cursorId: hunkAt(list, current.state.selection.from)?.id ?? null }
    },
    // The list only changes with the document, and is then a new array.
    equalityFn: (a, b) => b !== null && a.hunks === b.hunks && a.cursorId === b.cursorId,
  })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const leaveTimer = useRef<number | undefined>(undefined)

  const keepHover = useCallback(() => window.clearTimeout(leaveTimer.current), [])
  const releaseHover = useCallback(() => {
    window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => setHoverId(null), HOVER_GRACE_MS)
  }, [])

  useEffect(() => {
    const dom = editor.view.dom
    const over = (event: MouseEvent) => {
      const id = (event.target as Element | null)?.closest?.('[data-suggestion-id]')?.getAttribute('data-suggestion-id') ?? null
      if (id) {
        keepHover()
        setHoverId(id)
      } else {
        releaseHover()
      }
    }
    dom.addEventListener('mouseover', over)
    dom.addEventListener('mouseleave', releaseHover)
    return () => {
      dom.removeEventListener('mouseover', over)
      dom.removeEventListener('mouseleave', releaseHover)
      window.clearTimeout(leaveTimer.current)
    }
  }, [editor, keepHover, releaseHover])

  const active = hunks.find((hunk) => hunk.id === hoverId) ?? hunks.find((hunk) => hunk.id === cursorId) ?? null

  const go = (direction: 1 | -1) => {
    const target = adjacentHunk(hunks, editor.state.selection.from, active?.id ?? null, direction)
    if (!target) return
    setHoverId(null)
    const { tr } = editor.state
    editor.view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(target.from))).scrollIntoView())
    editor.view.focus()
  }

  const resolve = (match: (ref: SuggestionRef) => boolean, action: SuggestionAction) => {
    const tr = resolveSuggestions(editor.state.tr, match, action)
    if (!tr.docChanged) return
    setHoverId(null)
    editor.view.dispatch(tr)
    onResolved?.()
  }

  return { hunks, active, go, resolve, keepHover, releaseHover }
}
