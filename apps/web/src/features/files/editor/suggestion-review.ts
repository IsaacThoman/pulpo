import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { adjacentHunk, docSuggestions, hunkAt, SUGGESTION_REVIEW_META, summarizeHunk } from '@pulpo/client-core/doc-editor'
import { resolveSuggestions, type SuggestionAction, type SuggestionHunk, type SuggestionRef } from '@pulpo/client-core/doc-schema'
import { Plugin, PluginKey, Selection, type EditorState } from '@tiptap/pm/state'
import { Extension, useEditorState, type Editor } from '@tiptap/react'
import { ui, uit } from '@/i18n/ui'
import { hasPrimaryModifier, isAppleShortcut } from '../browser/shortcuts'

export { adjacentHunk, docSuggestions, hunkAt } from '@pulpo/client-core/doc-editor'

/** What a hunk does, in a few words: "Replace “a” with “b”". */
export function describeHunk(hunk: Pick<SuggestionHunk, 'inserted' | 'deleted'>): string {
  const summary = summarizeHunk(hunk)
  switch (summary.kind) {
    case 'replace': return uit`Replace “${summary.deleted}” with “${summary.inserted}”`
    case 'add': return uit`Add “${summary.inserted}”`
    case 'delete': return uit`Delete “${summary.deleted}”`
    case 'add-whitespace': return ui("Add a space or line break")
    case 'delete-whitespace': return ui("Delete a space or line break")
    case 'layout': return ui("Change the layout")
  }
}

/**
 * How long the card stays after the pointer leaves its suggestion, for plain text or another
 * suggestion, so it can be reached across whatever lies between.
 */
const HOVER_GRACE_MS = 250

/**
 * The card's shortcuts: Mod-Alt-Enter accepts and Mod-Alt-Backspace rejects. Not while AltGr is held
 * (`altGraph`), which Windows sends as Ctrl-Alt: someone typing ą or € may still hold it when they
 * press Backspace.
 */
export function suggestionShortcut(event: globalThis.KeyboardEvent, altGraph: boolean): SuggestionAction | null {
  if (!event.altKey || event.shiftKey || !hasPrimaryModifier(event) || altGraph) return null
  return event.key === 'Enter' ? 'accept' : event.key === 'Backspace' ? 'reject' : null
}

/** What each editor's suggestion review does with a key typed in its document. */
const reviewKeys = new WeakMap<Editor, (event: globalThis.KeyboardEvent) => boolean>()

/**
 * Hands keys typed in the document to `useSuggestionReview` before the editor handles them itself:
 * it takes any Backspace, whatever the modifiers, to delete a line break before the cursor.
 */
export const SuggestionReviewKeys = Extension.create({
  name: 'suggestionReviewKeys',
  // Ahead of the keymaps.
  priority: 1000,
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      key: new PluginKey('suggestionReviewKeys'),
      props: {
        handleKeyDown: (_view, event) => {
          if (!reviewKeys.get(editor)?.(event)) return false
          event.stopPropagation()
          return true
        },
      },
    })]
  },
})

/** The document position under the pointer, when there is one. */
function pointerPos(editor: Editor, event: MouseEvent): number | null {
  try {
    return editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null
  } catch {
    // Measuring fails while the view updates, or without layout.
    return null
  }
}

/** The hunk under the pointer, and how far into it the pointer reached it. */
type Hover = { id: string; offset: number | null }

/** The suggestion an event's target is in. */
function suggestionIdOf(event: Event): string | null {
  return (event.target as Element | null)?.closest?.('[data-suggestion-id]')?.getAttribute('data-suggestion-id') ?? null
}

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
  const { hunks, cursorId, cursorPos } = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const cursorId = cursorHunkId(current.state)
      return { hunks: docSuggestions(current.state.doc), cursorId, cursorPos: cursorId ? current.state.selection.from : null }
    },
    // The list only changes with the document, and is then a new array.
    equalityFn: (a, b) => b !== null && a.hunks === b.hunks && a.cursorId === b.cursorId && a.cursorPos === b.cursorPos,
  })
  const [hover, setHover] = useState<Hover | null>(null)
  // The hunk at the cursor whose card Escape closed, until the cursor leaves it.
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const previousHunks = useRef(hunks.map((hunk) => hunk.id).join(','))
  const hoverTimer = useRef<number | undefined>(undefined)
  // The hunk whose card is showing, for the pointer handlers.
  const shownId = useRef<string | null>(null)
  // Whether AltGr is held. Firefox reports any Ctrl-Alt as AltGraph, so this goes by the key.
  const altGraph = useRef(false)

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
  /** Hovers `next`, or nothing, at once. */
  const hoverNow = useCallback((next: Hover | null) => {
    window.clearTimeout(hoverTimer.current)
    // Before React shows the card, so the pointer moving straight on is handled as leaving it.
    shownId.current = next?.id ?? null
    setHover(next)
  }, [])
  const releaseHover = useCallback(() => hoverSoon(null), [hoverSoon])
  const clearHover = () => {
    window.clearTimeout(hoverTimer.current)
    setHover(null)
  }

  useEffect(() => {
    const dom = editor.view.dom
    /** The suggestion the pointer is on, if any, and where. */
    const pointedAt = (event: MouseEvent): Hover | null => {
      const id = suggestionIdOf(event)
      const hunk = id ? docSuggestions(editor.state.doc).find((item) => item.id === id) : undefined
      const pos = hunk ? pointerPos(editor, event) : null
      return id ? { id, offset: hunk && pos !== null ? pos - hunk.from : null } : null
    }
    const over = (event: MouseEvent) => {
      const id = suggestionIdOf(event)
      if (id && id === shownId.current) keepHover()
      else if (id && !shownId.current) hoverNow(pointedAt(event))
      // On the way to the card the pointer may cross other suggestions, or the block suggestion
      // around an inline one; they only take the card over once the pointer stays.
      else hoverSoon(pointedAt(event))
    }
    // Clicking a suggestion picks it at once. A touch never travels to the card, so a tap picks
    // whatever it lands on; that waits for its click, which comes once the caret is placed and not
    // after a swipe to scroll. (WebKit gives clicks from taps the pointer type "mouse".)
    let pointerType = 'mouse'
    const press = (event: PointerEvent) => {
      pointerType = event.pointerType
      const next = pointedAt(event)
      if (next && pointerType === 'mouse') hoverNow(next)
    }
    const tap = (event: MouseEvent) => {
      if (pointerType !== 'mouse') hoverNow(pointedAt(event))
    }
    // Moving onto the card keeps the suggestion. React runs the card's onPointerEnter before this
    // mouseleave, so starting the timer here would hide the card under the pointer.
    const leave = (event: MouseEvent) => {
      if (!(event.relatedTarget as Element | null)?.closest?.('[data-suggestion-card]')) releaseHover()
    }
    dom.addEventListener('mouseover', over)
    dom.addEventListener('pointerdown', press)
    dom.addEventListener('click', tap)
    dom.addEventListener('mouseleave', leave)
    return () => {
      dom.removeEventListener('mouseover', over)
      dom.removeEventListener('pointerdown', press)
      dom.removeEventListener('click', tap)
      dom.removeEventListener('mouseleave', leave)
      window.clearTimeout(hoverTimer.current)
    }
  }, [editor, keepHover, hoverSoon, hoverNow, releaseHover])

  useEffect(() => {
    if (dismissedId && dismissedId !== cursorId) setDismissedId(null)
  }, [cursorId, dismissedId])

  useEffect(() => {
    // The shortcuts use Cmd on Apple platforms, so their right Option key is no AltGr to avoid.
    if (isAppleShortcut()) return
    const track = (event: globalThis.KeyboardEvent) => {
      // The right Alt key is AltGr on layouts that have one, and plain Alt elsewhere.
      if (event.code === 'AltRight') altGraph.current = event.type === 'keydown' && event.key === 'AltGraph'
    }
    const release = () => {
      altGraph.current = false
    }
    window.addEventListener('keydown', track, true)
    window.addEventListener('keyup', track, true)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', track, true)
      window.removeEventListener('keyup', track, true)
      window.removeEventListener('blur', release)
    }
  }, [])

  const hovered = hover ? hunks.find((hunk) => hunk.id === hover.id) : undefined
  const atCursor = cursorId === dismissedId ? undefined : hunks.find((hunk) => hunk.id === cursorId)
  const active = hovered || atCursor || null
  // The card goes under the line looked at in a long hunk: the one pointed at, or the cursor's.
  const anchor = hover && hovered ? (hover.offset === null ? null : hovered.from + hover.offset) : atCursor ? cursorPos : null
  useLayoutEffect(() => {
    shownId.current = active?.id ?? null
  })

  /** Steps to the next or previous hunk and puts the cursor there; the caller scrolls to it. */
  const go = (direction: 1 | -1): SuggestionHunk | null => {
    const target = adjacentHunk(hunks, editor.state.selection.from, active?.id ?? null, direction)
    if (!target) return null
    clearHover()
    setDismissedId(null)
    const { tr } = editor.state
    const selection = Selection.near(tr.doc.resolve(target.from))
    stepped.current = { id: target.id, pos: selection.from }
    editor.view.dispatch(tr.setSelection(selection))
    editor.view.focus()
    return target
  }

  const resolve = (match: (ref: SuggestionRef) => boolean, action: SuggestionAction) => {
    const tr = resolveSuggestions(editor.state.tr.setMeta(SUGGESTION_REVIEW_META, true), match, action)
    if (!tr.docChanged) return
    // A keyboard user's focus is on the button used, which can go with the card or the bar;
    // it moves back to the document rather than falling to the page.
    const refocus = Boolean(document.activeElement?.closest('[data-suggestion-card], [data-suggestion-bar]'))
    clearHover()
    editor.view.dispatch(tr)
    if (refocus) editor.view.focus()
  }

  /**
   * Escape closes the card, and the shortcuts resolve the hunk it is for, or else the one at the
   * cursor. Reads the editor's state, which can be ahead of the last render. True when handled.
   */
  const handleKey = (event: globalThis.KeyboardEvent): boolean => {
    if (event.isComposing) return false
    const cursorNow = cursorHunkId(editor.state)
    const hoveredNow = hover && docSuggestions(editor.state.doc).some((hunk) => hunk.id === hover.id) ? hover.id : null
    if (event.key === 'Escape') {
      if (!hoveredNow && (!cursorNow || cursorNow === dismissedId)) return false
      clearHover()
      setDismissedId(cursorNow)
      return true
    }
    const action = suggestionShortcut(event, altGraph.current)
    if (!action || !editor.isEditable) return false
    // The keys do nothing else: held down, they would go on to the next suggestion, and with none
    // at the cursor, Backspace would delete a line break before it.
    const target = hoveredNow ?? cursorNow
    if (target && !event.repeat) resolve((ref) => ref.id === target, action)
    return true
  }
  useLayoutEffect(() => {
    reviewKeys.set(editor, handleKey)
    return () => {
      reviewKeys.delete(editor)
    }
  })

  /** The same keys elsewhere around the document: on the card, the review bar and the toolbar. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as Element
    // Keys in the document went to `handleKey` already; keys in portals, such as menus, aren't ours.
    if (editor.view.dom.contains(target) || !event.currentTarget.contains(target)) return
    if (!handleKey(event.nativeEvent)) return
    event.preventDefault()
    event.stopPropagation()
    // The card is gone with the button that had focus.
    if (event.key === 'Escape' && target.closest('[data-suggestion-card]')) editor.view.focus()
  }

  return { hunks, active, anchor, go, resolve, keepHover, releaseHover, onKeyDown }
}
