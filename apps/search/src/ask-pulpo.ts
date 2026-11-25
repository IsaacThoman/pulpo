import { normalizeSearchHandoff, searchHandoffPath } from '@pulpo/contracts/search'

export function buildAskPulpoUrl(pulpoOrigin: string, query: string, results: readonly { url: string }[]): string | undefined {
  const handoff = normalizeSearchHandoff(query, results.map(({ url }) => url))
  if (!handoff) return undefined
  return new URL(searchHandoffPath(handoff), pulpoOrigin).href
}
