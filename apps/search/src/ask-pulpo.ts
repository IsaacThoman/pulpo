import { normalizeSearchHandoff, normalizeSearchHandoffSource, searchHandoffPath } from '@pulpo/contracts/search'

export function buildAskPulpoUrl(pulpoOrigin: string, query: string, results: readonly { url: string }[]): string | undefined {
  const firstByHost: string[] = []
  const remaining: string[] = []
  const hosts = new Set<string>()
  const visited = new Set<string>()
  for (const { url: value } of results) {
    const url = normalizeSearchHandoffSource(value)
    if (!url) continue
    const host = url.hostname.replace(/^www\./, '')
    const path = host === 'sciencedirect.com' ? url.pathname.replace(/^\/science\/article\/abs\/pii\//, '/science/article/pii/') : url.pathname
    const identity = host + path + url.search
    if (visited.has(identity)) continue
    visited.add(identity)
    if (hosts.has(host)) remaining.push(url.href)
    else firstByHost.push(url.href)
    hosts.add(host)
  }
  const handoff = normalizeSearchHandoff(query, [...firstByHost, ...remaining])
  if (!handoff) return undefined
  return new URL(searchHandoffPath(handoff), pulpoOrigin).href
}
