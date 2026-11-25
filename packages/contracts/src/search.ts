export function isSearchFaviconHost(host: string): boolean {
  return host.length <= 253
    && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)
    && !/\.(?:arpa|example|internal|invalid|lan|local|localdomain|localhost|onion|test|ts\.net)$/.test(host)
}

export interface SearchDateRange {
  from: string
  to: string
}

export function isSearchCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function searchDateRange(from: string, to: string): SearchDateRange | undefined {
  return isSearchCalendarDate(from) && isSearchCalendarDate(to) && from <= to ? { from, to } : undefined
}

export const searchRegions = [
  ['', 'Any region'],
  ['us', 'United States'],
  ['gb', 'United Kingdom'],
  ['au', 'Australia'],
  ['br', 'Brazil'],
  ['ca', 'Canada'],
  ['fr', 'France'],
  ['de', 'Germany'],
  ['in', 'India'],
  ['it', 'Italy'],
  ['jp', 'Japan'],
  ['nl', 'Netherlands'],
  ['es', 'Spain'],
] as const

export type SearchRegion = (typeof searchRegions)[number][0]
export type SearchDomainRule = 'pin' | 'hide'

export interface SearchCustomBang {
  trigger: string
  name: string
  url: string
}

export interface SearchAccountPreferences {
  defaultProvider: 'kagi' | 'firecrawl' | ''
  fallbackProvider: 'kagi' | 'firecrawl' | 'none' | ''
  limit: 10 | 20 | 40
  newTab: boolean
  keyboardShortcuts: boolean
  localPlaces: boolean
  defaultRegion: SearchRegion
  safeSearch: boolean
  domains: Record<string, SearchDomainRule>
  bangs: SearchCustomBang[]
}

export const defaultSearchAccountPreferences: SearchAccountPreferences = {
  defaultProvider: '',
  fallbackProvider: '',
  limit: 40,
  newTab: false,
  keyboardShortcuts: true,
  localPlaces: true,
  defaultRegion: '',
  safeSearch: true,
  domains: {},
  bangs: [],
}

export const SEARCH_ACCOUNT_PREFERENCES_KEY = 'searchPreferences'

export function normalizeSearchBangTrigger(trigger: string): string {
  return trigger.trim().replace(/^!/, '').toLowerCase()
}

export function validateSearchCustomBang(bang: SearchCustomBang): string | null {
  if (!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(normalizeSearchBangTrigger(bang.trigger))) {
    return 'Use 1–24 letters, digits, hyphens, or underscores for the shortcut.'
  }
  if (!bang.name.trim() || bang.name.length > 80) return 'Enter a name up to 80 characters.'
  const url = bang.url.trim()
  const marker = 'pulpo-search-bang-query-placeholder'
  if (!url.includes('{query}') || url.includes(marker) || url.length > 2_048) {
    return 'Enter a destination URL with {query} in its path or query string.'
  }
  try {
    const parsed = new URL(url.replaceAll('{query}', marker))
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.host.includes(marker)
      && !parsed.hash.includes(marker) && (parsed.pathname.includes(marker) || parsed.search.includes(marker))) return null
  } catch {
    // Use the same validation message for malformed URLs.
  }
  return 'Use an HTTPS destination with {query} only in its path or query string.'
}

export const SEARCH_HANDOFF_PATH = '/search/ask'

const MAX_HANDOFF_QUERY_LENGTH = 500
const MAX_HANDOFF_SOURCE_COUNT = 5
const MAX_HANDOFF_SOURCE_LENGTH = 512
// A UTF-16 unit can become nine percent-encoded characters. Canonical HTTP URLs are ASCII.
const MAX_HANDOFF_FRAGMENT_LENGTH = '#q='.length + MAX_HANDOFF_QUERY_LENGTH * 9
  + MAX_HANDOFF_SOURCE_COUNT * ('&source='.length + MAX_HANDOFF_SOURCE_LENGTH * 3)

export interface SearchHandoff {
  query: string
  sources: string[]
}

export function normalizeSearchHandoffSource(value: string): URL | undefined {
  if (value.length > MAX_HANDOFF_SOURCE_LENGTH) return
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password && !url.port
      && isSearchFaviconHost(url.hostname) && url.href.length <= MAX_HANDOFF_SOURCE_LENGTH) return url
  } catch {
    return
  }
}

export function normalizeSearchHandoff(query: string, sources: Iterable<string>): SearchHandoff | undefined {
  const question = query.trim()
  if (!question || question.length > MAX_HANDOFF_QUERY_LENGTH) return undefined

  const urls = new Set<string>()
  for (const value of sources) {
    const url = normalizeSearchHandoffSource(value)
    if (!url) continue
    urls.add(url.href)
    if (urls.size === MAX_HANDOFF_SOURCE_COUNT) break
  }
  if (!urls.size) return undefined
  return { query: question, sources: [...urls] }
}

export function searchHandoffPath(handoff: SearchHandoff): string {
  const params = new URLSearchParams({ q: handoff.query })
  for (const url of handoff.sources) params.append('source', url)
  return `${SEARCH_HANDOFF_PATH}#${params}`
}

export function readSearchHandoff(hash: string): SearchHandoff | undefined {
  if (!hash.startsWith('#') || hash.length > MAX_HANDOFF_FRAGMENT_LENGTH) return undefined
  const params = new URLSearchParams(hash.slice(1))
  return normalizeSearchHandoff(params.get('q') ?? '', params.getAll('source'))
}
