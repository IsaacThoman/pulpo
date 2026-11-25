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

export function consecutiveSiteResults(entries: ResultWithUrl[], groupSites: boolean) {
  const groups: Array<{ lead: ResultWithUrl; additional: ResultWithUrl[] }> = []
  for (const entry of entries) {
    const previous = groups.at(-1)
    if (groupSites && previous?.lead.host === entry.host) previous.additional.push(entry)
    else groups.push({ lead: entry, additional: [] })
  }
  return groups
}
