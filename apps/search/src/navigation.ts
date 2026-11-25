import { searchDateRange, searchRegions, type SearchDateRange } from '@pulpo/contracts/search'
import type { Category, Provider, SearchDate, SearchScope } from './api'
import { queryTokens } from './query-tokens'
import { reusableImageCategories, reusableImageLicenses, type ReusableImageFilters } from './reusable-images'

export const MAX_QUERY_LENGTH = 500
export const categories = ['web', 'images', 'news', 'videos', 'podcasts'] as const
export const searchScopes = [
  ['', 'All sites'],
  ['developer', 'Developer'],
  ['discussions', 'Discussions'],
  ['academic', 'Academic'],
] as const
export const dateOptions = [
  ['', 'Any time'],
  ['day', 'Past day'],
  ['week', 'Past week'],
  ['month', 'Past month'],
  ['year', 'Past year'],
] as const

export const regions = searchRegions

export interface SearchLocation {
  query: string
  category: Category
  date: SearchDate | ''
  dateOverride?: true
  dateRange?: SearchDateRange
  invalidDateRange?: true
  region: string
  regionOverride?: true
  safeSearch?: boolean
  scope?: SearchScope
  web?: true
  provider?: Provider
  reusableImages?: ReusableImageFilters
}

export const homeLocation: SearchLocation = { query: '', category: 'web', date: '', region: '' }

export function recentNewsQuery(query: string) {
  return /\b(?:latest|today|breaking|this week)\b/i.test(query)
}

export function parseSearchLocation(url: URL): SearchLocation {
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH)
  if (!query) return homeLocation
  const category = categories.find(value => value === url.searchParams.get('type')) ?? 'web'
  const date = dateOptions.find(([value]) => value === url.searchParams.get('date'))?.[0] ?? ''
  const dateRange = !date && searchDateRange(url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '')
  const invalidDateRange = !dateRange && (url.searchParams.has('from') || url.searchParams.has('to'))
  const region = regions.find(([value]) => value === url.searchParams.get('region'))?.[0] ?? ''
  const regionOverride = url.searchParams.get('region') === 'any'
  const safeSearch = url.searchParams.get('safe')
  const scope = searchScopes.find(([value]) => value === url.searchParams.get('scope'))?.[0] || undefined
  const provider = url.searchParams.get('provider')
  const reusable = category === 'images' && url.searchParams.get('reuse') === '1'
  const license = reusableImageLicenses.find(value => value === url.searchParams.get('license'))
  const imageCategory = reusableImageCategories.find(value => value === url.searchParams.get('kind'))
  return {
    query, category, date, region,
    ...(category === 'news' && url.searchParams.get('date') === 'any' ? { dateOverride: true as const } : {}),
    ...(dateRange ? { dateRange } : {}),
    ...(invalidDateRange ? { invalidDateRange: true as const } : {}),
    ...(regionOverride ? { regionOverride: true as const } : {}),
    ...(safeSearch === 'on' || safeSearch === 'off' ? { safeSearch: safeSearch === 'on' } : {}),
    ...(category === 'web' && scope ? { scope } : {}),
    ...(url.searchParams.get('web') === '1' ? { web: true as const } : {}),
    ...(provider === 'kagi' || provider === 'firecrawl' ? { provider } : {}),
    ...(reusable ? { reusableImages: { ...(license ? { license } : {}), ...(imageCategory ? { category: imageCategory } : {}) } } : {}),
  }
}

export function searchPath(input: SearchLocation) {
  if (!input.query) return '/'
  const params = new URLSearchParams({ q: input.query })
  if (input.category !== 'web') params.set('type', input.category)
  if (input.date) params.set('date', input.date)
  else if (input.dateRange) {
    params.set('from', input.dateRange.from)
    params.set('to', input.dateRange.to)
  } else if (input.category === 'news' && input.dateOverride) params.set('date', 'any')
  if (input.region) params.set('region', input.region)
  else if (input.regionOverride) params.set('region', 'any')
  if (input.safeSearch !== undefined) params.set('safe', input.safeSearch ? 'on' : 'off')
  if (input.scope && input.category === 'web') params.set('scope', input.scope)
  if (input.web) params.set('web', '1')
  if (input.provider) params.set('provider', input.provider)
  if (input.category === 'images' && input.reusableImages) {
    params.set('reuse', '1')
    if (input.reusableImages.license) params.set('license', input.reusableImages.license)
    if (input.reusableImages.category) params.set('kind', input.reusableImages.category)
  }
  return '/search?' + params.toString()
}

export function withoutSiteOperators(query: string) {
  const tokens = queryTokens(query).map(token => token.text)
  const remaining = tokens.filter(token => !/^-?site:[a-z\d-]+(?:\.[a-z\d-]+)+\.?$/i.test(token))
  return remaining.length && remaining.length < tokens.length ? remaining.join(' ') : ''
}

export function localMapSearch(query: string) {
  const intent = /^(?:directions to|map of)\s+/i.test(query)
    || /\b(?:restaurants?|coffee shops?|caf[eé]s?|bookstores?|pharmac(?:y|ies)|grocery stores?|museums?|hotels?|parks?)\s+(?:near|around|in)\s+\S/i.test(query)
  if (!intent) return
  const destination = new URL('https://www.google.com/maps/search/')
  destination.searchParams.set('api', '1')
  destination.searchParams.set('query', query.replace(/^(?:directions to|map of)\s+/i, ''))
  return destination.href
}

export function safeHttpUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url
  } catch {
    return undefined
  }
}
