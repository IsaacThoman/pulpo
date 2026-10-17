/*
 * Hunk summaries without the editor: imported by clients that describe suggestions outside the
 * editor (e.g. the mobile review bar) without loading TipTap.
 */

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

export function summarizeHunk(hunk: { inserted: string; deleted: string }): HunkSummary {
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
