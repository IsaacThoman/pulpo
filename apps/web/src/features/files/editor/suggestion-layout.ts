import type { SuggestionHunk } from '@pulpo/client-core/doc-schema'
import type { EditorView } from '@tiptap/pm/view'

/** How far below the text the card sits. */
const CARD_GAP = 6
/** Without room under a hunk's last line, the card goes under the line looked at if this far above it. */
const CARD_REACH = 80
/** Room kept for the card under a suggestion. */
const CARD_ROOM = 96
/** Room kept between a suggestion scrolled to and the edges. */
const REVEAL_MARGIN = 16

function scrollParent(element: Element): Element | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent
  }
  return null
}

/**
 * Where a hunk's card goes, in viewport coordinates: under the hunk. When that is out of view,
 * in a long hunk it goes under the line at `anchor` (where the pointer or cursor is) instead, so
 * it shows near where the user looks without covering text they can see the end of.
 */
export function cardSpot(view: EditorView, hunk: SuggestionHunk, anchor: number | null): { top: number; left: number } {
  const start = view.coordsAtPos(hunk.from, 1)
  const end = view.coordsAtPos(hunk.to, -1)
  const last = Math.max(start.bottom, end.bottom)
  // The visual viewport leaves out an on-screen keyboard.
  const viewport = window.visualViewport
  const visibleBottom = Math.min(scrollParent(view.dom)?.getBoundingClientRect().bottom ?? Infinity, viewport ? viewport.offsetTop + viewport.height : window.innerHeight)
  const line = anchor === null || last + CARD_ROOM <= visibleBottom ? last : view.coordsAtPos(Math.min(Math.max(anchor, hunk.from), hunk.to)).bottom
  return { top: (last - line > CARD_REACH ? line : last) + CARD_GAP, left: start.left }
}

/**
 * Scrolls to a suggestion stepped to with the cursor at its start: when it or room for its card
 * is out of view, or under the sticky `header`, it lands a third of the way down.
 */
export function revealSuggestion(view: EditorView, hunk: SuggestionHunk, header: HTMLElement | null) {
  const scroller = scrollParent(view.dom)
  const frame = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight }
  const top = Math.max(frame.top, header?.getBoundingClientRect().bottom ?? frame.top) + REVEAL_MARGIN
  const bottom = frame.bottom - REVEAL_MARGIN
  let textTop: number
  let cardTop: number
  try {
    textTop = view.coordsAtPos(hunk.from, 1).top
    cardTop = cardSpot(view, hunk, hunk.from).top
  } catch {
    // Measuring fails while the view updates.
    return
  }
  if (textTop >= top && cardTop + CARD_ROOM <= bottom) return
  const by = textTop - (top + (bottom - top) / 3)
  if (scroller) scroller.scrollTop += by
  else window.scrollBy(0, by)
}
