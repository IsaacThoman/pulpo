import type { SearchResponse, SearchResult } from './api'
import { safeHttpUrl } from './navigation'
import { domainRule, type DomainRule, type Preferences } from './preferences'

export interface ResultWithUrl {
  result: SearchResult
  url: URL
  host: string
  rule: DomainRule | undefined
}

export function resultEntries(data: SearchResponse, preferences: Preferences): ResultWithUrl[] {
  return data.results.flatMap(result => {
    const url = safeHttpUrl(result.url)
    if (!url) return []
    const host = url.hostname.replace(/^www\./, '').replace(/\.$/, '')
    return [{ result, url, host, rule: domainRule(host, preferences.domains) }]
  })
}

export function visibleEntries(entries: ResultWithUrl[], showHidden: boolean) {
  return entries.filter(entry => showHidden || entry.rule !== 'hide')
    .sort((a, b) => Number(b.rule === 'pin') - Number(a.rule === 'pin'))
}

export function firstVisibleResultUrl(data: SearchResponse, preferences: Preferences): URL | undefined {
  return visibleEntries(resultEntries(data, preferences), false)[0]?.url
}

interface ResultGroup {
  rank: number
  lead: ResultWithUrl
  additional: ResultWithUrl[]
  versions: { url: URL; label: string }[]
}

const versionSegment = /^v?\d{1,3}(?:\.(?:\d{1,3}|x)){0,2}$/i
const explicitVersion = /(?:\bv\d{1,3}|\d{1,3}(?:\.(?:\d{1,3}|x)){1,2})(?![\p{L}\p{N}])/iu
const comparisonQuery = /\b(?:versions?|releases?|vs|versus|compar(?:e|ing|isons?)|differences?)\b/i

function documentVersion(url: URL) {
  const segments = url.pathname.slice(1).split('/')
  if (url.hostname === 'docs.python.org' && segments[0] === 'release' && versionSegment.test(segments[1] ?? '')) {
    segments.shift()
  }
  const docsHost = /^(?:docs?|documentation)\./i.test(url.hostname)
  const index = segments.slice(0, 3).findIndex((segment, position) => versionSegment.test(segment)
    && (docsHost || segments.slice(0, position).some(part => /^(?:docs?|documentation|manual|reference)$/i.test(part))))
  if (index === -1 || !segments.slice(index + 1).some(Boolean)) return
  return {
    label: segments[index]!,
    key: JSON.stringify([url.origin, segments.slice(0, index), segments.slice(index + 1), url.search, url.hash]),
  }
}

export function groupResults(entries: ResultWithUrl[], webQuery: string | undefined) {
  const groupVersions = webQuery !== undefined && !explicitVersion.test(webQuery) && !comparisonQuery.test(webQuery)
  const groups: ResultGroup[] = []
  const nearbyDocs = new Map<string, { index: number; label: string; group: ResultGroup }>()
  for (const [index, entry] of entries.entries()) {
    const version = groupVersions ? documentVersion(entry.url) : undefined
    const nearby = version && nearbyDocs.get(version.key)
    // A version can join the lead only if another version was among the preceding three results.
    if (version && nearby && index - nearby.index <= 3 && nearby.label !== version.label
      && !nearby.group.versions.some(item => item.label === version.label)) {
      nearby.group.versions.push({ url: entry.url, label: version.label })
      nearby.index = index
    } else {
      const group: ResultGroup = { rank: index, lead: entry, additional: [], versions: [] }
      if (version) nearbyDocs.set(version.key, { index, label: version.label, group })
      groups.push(group)
    }
  }
  if (webQuery === undefined || /\bsite:/i.test(webQuery)) return groups

  const siteGroups: ResultGroup[] = []
  let previousRank = -1
  for (const group of groups) {
    const previous = siteGroups.at(-1)
    if (!group.versions.length && group.rank === previousRank + 1 && previous?.lead.host === group.lead.host
      && previous.additional.length < 2) previous.additional.push(group.lead)
    else siteGroups.push(group)
    previousRank = group.rank
  }
  return siteGroups
}
