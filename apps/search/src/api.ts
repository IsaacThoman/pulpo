import type { CurrencyQuery, CurrencyResponse } from './currency'
import type { PlaceQuery, PlaceResponse } from './places'

export type Provider = 'kagi' | 'firecrawl'
export type Category = 'web' | 'news' | 'images' | 'videos' | 'podcasts'
export type SearchDate = 'day' | 'week' | 'month' | 'year'
export type SearchScope = 'developer' | 'discussions' | 'academic'

export const providerNames: Record<Provider, string> = {
  kagi: 'Kagi',
  firecrawl: 'Firecrawl',
}

export interface SearchInput {
  query: string
  providers?: Provider[]
  limit?: number
  category?: Category
  region?: string
  date?: SearchDate
  scope?: SearchScope
  page?: number
}

export interface SearchResult {
  url: string
  title: string
  snippet: string
  imageUrl?: string
  thumbnailUrl?: string
  imageDimensions?: { width: number; height: number }
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
  provider: Provider
  results: SearchResult[]
  related?: string[]
  answer?: { title: string; snippet: string; url?: string }
  knowledge?: Knowledge
  hasMore?: boolean
}

export interface ProviderConfig {
  id: Provider
  categories: Category[]
  dates: SearchDate[]
  region: boolean
  priceMicros: number
  maxPage?: number
}

export interface SearchConfig {
  defaultOrder: Provider[]
  providers: ProviderConfig[]
  weather?: boolean
  currency?: boolean
  places?: { provider: 'brave'; priceMicros: number }
}

export interface WeatherPlace { name: string; admin?: string; country: string; timeZone: string }
export interface WeatherSource { name: string; url: string; license: string }
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
  appearance: (signal?: AbortSignal) => request<SearchAppearance>('/appearance', { signal }),
  session: (signal?: AbortSignal) => request<{ user: SearchUser | null }>('/auth/session', { signal }),
  exchange: (code: string, codeVerifier: string) => post<{ user: SearchUser }>('/auth/exchange', { code, codeVerifier }),
  logout: () => post<void>('/auth/logout'),
  config: (signal?: AbortSignal) => request<SearchConfig>('/config', { signal }),
  search: (input: SearchInput, signal?: AbortSignal) => post<SearchResponse>('/query', input, signal),
}
import type { CustomTheme } from '@pulpo/contracts'
