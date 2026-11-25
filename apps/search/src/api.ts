import type { SearchDateRange } from '@pulpo/contracts/search'
import type { CurrencyQuery, CurrencyResponse } from './currency'
import type { PlaceProvider, PlaceQuery, PlaceResponse } from './places'
import type { ReusableImageFilters } from './reusable-images'

export type Provider = 'kagi' | 'firecrawl'
export type Category = 'web' | 'news' | 'images' | 'videos' | 'podcasts'
export type SearchDate = 'day' | 'week' | 'month' | 'year'
export type SearchScope = 'developer' | 'discussions' | 'academic'

export const providerNames: Record<Provider | 'openverse', string> = {
  kagi: 'Kagi',
  firecrawl: 'Firecrawl',
  openverse: 'Openverse',
}

export function formatSearchPrice(micros: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(micros / 1_000_000)
}

export interface SearchInput {
  query: string
  providers?: Provider[]
  limit?: number
  expandedImages?: true
  category?: Category
  region?: string
  date?: SearchDate
  dateRange?: SearchDateRange
  scope?: SearchScope
  page?: number
}

export interface ReusableImagesInput extends ReusableImageFilters {
  query: string
  page?: number
}

export type SearchRequest = SearchInput | (ReusableImagesInput & { reusable: true })

export interface ImageLicense {
  code: string
  version?: string
  url: string
  creator?: string
  creatorUrl?: string
  attribution?: string
}

interface ReusableImagesResponse {
  provider: 'openverse'
  hasMore: boolean
  results: Array<{
    title: string
    imageUrl: string
    thumbnailUrl: string
    sourceUrl: string
    license: Pick<ImageLicense, 'code' | 'version' | 'url'>
    creator?: string
    creatorUrl?: string
    attribution?: string
    width?: number
    height?: number
  }>
}

export interface SearchResult {
  url: string
  title: string
  snippet: string
  imageUrl?: string
  thumbnailUrl?: string
  imageDimensions?: { width: number; height: number }
  imageLicense?: ImageLicense
  duration?: string
  creatorName?: string
  publishedAt?: string
}

export interface Knowledge {
  title: string
  summary: string
  url: string
  facts: Array<{ label: string; value: string }>
}

export interface SearchResponse {
  provider: Provider | 'openverse'
  results: SearchResult[]
  related?: string[]
  answer?: { title: string; snippet: string; url?: string }
  knowledge?: Knowledge
  hasMore?: boolean
}

export interface QuickAnswerResponse {
  provider: 'kagi'
  answer: string
  references: Array<{ index: number; url: string; title?: string; snippet?: string }>
}

export interface ProviderConfig {
  id: Provider
  categories: Category[]
  dates: SearchDate[]
  customDateRanges?: Category[]
  region: boolean
  priceMicros: number
  maxPage?: number
  expandedImages?: true
}

export interface SearchConfig {
  defaultOrder: Provider[]
  providers: ProviderConfig[]
  weather?: boolean
  currency?: boolean
  places?: { provider: PlaceProvider; priceMicros: number }
  quickAnswer?: { provider: 'kagi'; priceMicros: number }
  reusableImages?: true
}

export interface WeatherPlace { name: string; admin?: string; country: string; timeZone: string }
export interface WeatherSource { name: string; url: string; license: string; note?: string }
export type WeatherAlerts = { status: 'unavailable' } | {
  status: 'available'
  source: WeatherSource
  alerts: Array<{ event: string; headline?: string; severity: string; effectiveAt: string; expiresAt: string; url?: string }>
}
export type WeatherResponse = { sources: WeatherSource[] } & (
  | { status: 'forecast'; place: WeatherPlace; forecast: {
    updatedAt: string; validAt: string; temperatureC: number; condition?: string; windKph?: number
    precipitationMm?: number; precipitationChance?: number
    hourly?: Array<{ validAt: string; temperatureC: number; condition?: string; precipitationChance?: number }>
    daily: Array<{ date: string; lowC: number; highC: number; condition?: string }>
  } }
  | { status: 'ambiguous'; places: Array<WeatherPlace & { query: string }> }
  | { status: 'not-found' }
  | { status: 'unavailable'; place?: WeatherPlace }
)

export interface SearchUser {
  id: string
  name: string
  email: string
}

export interface SearchAppearance {
  theme: 'system' | 'light' | 'dark'
  colorTheme: string
  customTheme?: CustomTheme
  instanceTheme?: CustomTheme
}

export class SearchApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'SearchApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch('/api/search' + path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new SearchApiError('Could not reach Pulpo Search. Check your connection and try again.', 0)
  }

  const body = response.headers.get('content-type')?.includes('application/json')
    ? await response.json().catch(() => null)
    : null
  if (!response.ok) {
    const message = response.status < 500 && typeof body?.error?.message === 'string'
      ? body.error.message
      : 'Pulpo Search is temporarily unavailable. Try again in a moment.'
    throw new SearchApiError(message, response.status, body?.error?.code)
  }
  if (response.status === 204) return undefined as T
  if (!body) throw new SearchApiError('Pulpo Search returned an unexpected response.', response.status)
  return body
}

function post<T>(path: string, body?: object, signal?: AbortSignal) {
  return request<T>(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
}

export const api = {
  weather: (location: string, signal?: AbortSignal) => request<WeatherResponse>('/weather?' + new URLSearchParams({ location }), { signal }),
  weatherAlerts: (location: string, signal?: AbortSignal) => request<WeatherAlerts>('/weather/alerts?' + new URLSearchParams({ location }), { signal }),
  currency: (query: CurrencyQuery, signal?: AbortSignal) => post<CurrencyResponse>('/currency', query, signal),
  places: (query: PlaceQuery, signal?: AbortSignal) => post<PlaceResponse>('/places', query, signal),
  quickAnswer: (query: string, signal?: AbortSignal) => post<QuickAnswerResponse>('/quick-answer', { query }, signal),
  reusableImages: async (input: ReusableImagesInput, signal?: AbortSignal): Promise<SearchResponse> => {
    const response = await post<ReusableImagesResponse>('/reusable-images', input, signal)
    return {
      provider: response.provider,
      hasMore: response.hasMore,
      results: response.results.map(({ title, imageUrl, thumbnailUrl, sourceUrl, license, creator, creatorUrl, attribution, width, height }) => ({
        title, imageUrl, thumbnailUrl, url: sourceUrl, snippet: '',
        ...(width && height ? { imageDimensions: { width, height } } : {}),
        imageLicense: { ...license, creator, creatorUrl, attribution },
      })),
    }
  },
  appearance: (signal?: AbortSignal) => request<SearchAppearance>('/appearance', { signal }),
  session: (signal?: AbortSignal) => request<{ user: SearchUser | null }>('/auth/session', { signal }),
  exchange: (code: string, codeVerifier: string) => post<{ user: SearchUser }>('/auth/exchange', { code, codeVerifier }),
  logout: () => post<void>('/auth/logout'),
  config: (signal?: AbortSignal) => request<SearchConfig>('/config', { signal }),
  search: (input: SearchInput, signal?: AbortSignal) => post<SearchResponse>('/query', input, signal),
}
import type { CustomTheme } from '@pulpo/contracts'
