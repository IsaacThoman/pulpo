import type { FindMatch } from '@pulpo/client-core/office/presentation/view'

/** Where a new search starts: the first match on the current slide or after it, as Slides does (else the first). */
export function firstMatchFrom(matches: readonly FindMatch[], slides: readonly string[], current: string | undefined): number {
  const at = current ? slides.indexOf(current) : -1
  const index = matches.findIndex((match) => slides.indexOf(match.slide) >= at)
  return index < 0 ? 0 : index
}
