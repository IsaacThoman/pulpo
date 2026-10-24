import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { listSuggestions, type SuggestionHunk } from '../doc-schema/suggestions.js'

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

export { describeHunkSummary, summarizeHunk, type HunkSummary } from './summary.js'
