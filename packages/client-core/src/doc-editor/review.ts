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

const QUOTE_LENGTH = 48

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > QUOTE_LENGTH ? `${flat.slice(0, QUOTE_LENGTH - 1)}…` : flat
}

/**
 * What a hunk does, for clients to put into words ("Replace “a” with “b”"): `inserted` and
 * `deleted` are short single-line excerpts.
 */
export type HunkSummary =
  | { kind: 'replace'; inserted: string; deleted: string }
  | { kind: 'add'; inserted: string }
  | { kind: 'delete'; deleted: string }
  | { kind: 'add-whitespace' | 'delete-whitespace' | 'layout' }

export function summarizeHunk(hunk: Pick<SuggestionHunk, 'inserted' | 'deleted'>): HunkSummary {
  const inserted = excerpt(hunk.inserted)
  const deleted = excerpt(hunk.deleted)
  if (inserted && deleted) return { kind: 'replace', inserted, deleted }
  if (inserted) return { kind: 'add', inserted }
  if (deleted) return { kind: 'delete', deleted }
  if (hunk.inserted) return { kind: 'add-whitespace' }
  if (hunk.deleted) return { kind: 'delete-whitespace' }
  return { kind: 'layout' }
}

/** The English wording of a hunk summary, for clients without translations. */
export function describeHunkSummary(summary: HunkSummary): string {
  switch (summary.kind) {
    case 'replace': return `Replace “${summary.deleted}” with “${summary.inserted}”`
    case 'add': return `Add “${summary.inserted}”`
    case 'delete': return `Delete “${summary.deleted}”`
    case 'add-whitespace': return 'Add a space or line break'
    case 'delete-whitespace': return 'Delete a space or line break'
    case 'layout': return 'Change the layout'
  }
}
