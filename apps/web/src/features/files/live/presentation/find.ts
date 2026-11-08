import type { FindMatch } from '@pulpo/client-core/office/presentation/view'

/**
 * Where Replace goes next in the new search: the first match from the replaced one's place on
 * that does not start inside the text just put in (it can match again, as "cat" → "cats" or a
 * case fix with Match case off do), else back to the first, as Word, Docs, and Slides do.
 * `end` is where the replacement ends in the replaced match's paragraph.
 */
export function nextAfterReplace(matches: readonly FindMatch[], index: number, replaced: FindMatch, end: number): number {
  const inserted = (match: FindMatch) =>
    match.slide === replaced.slide && match.shape === replaced.shape && match.row === replaced.row && match.column === replaced.column &&
    match.notes === replaced.notes && match.paragraph === replaced.paragraph && match.from >= replaced.from && match.from < end
  let next = Math.max(0, index)
  while (next < matches.length && inserted(matches[next]!)) next++
  return next < matches.length ? next : 0
}

/** Where a new search starts: the first match on the current slide or after it, as Slides does (else the first). */
export function firstMatchFrom(matches: readonly FindMatch[], slides: readonly string[], current: string | undefined): number {
  const at = current ? slides.indexOf(current) : -1
  const index = matches.findIndex((match) => slides.indexOf(match.slide) >= at)
  return index < 0 ? 0 : index
}
