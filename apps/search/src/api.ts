export type Provider = 'kagi' | 'firecrawl'
export type Category = 'web' | 'news' | 'images'
export type SearchDate = 'day' | 'week' | 'month' | 'year'

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
}

export interface SearchResult {
  url: string
  title: string
  snippet: string
  imageUrl?: string
  publishedAt?: string
}

export interface SearchResponse {
  provider: Provider
  results: SearchResult[]
  related?: string[]
  answer?: { title: string; snippet: string; url?: string }
}

export interface ProviderConfig {
  id: Provider
  categories: Category[]
  dates: SearchDate[]
  region: boolean
  priceMicros: number
}

export interface SearchConfig {
  defaultOrder: Provider[]
  providers: ProviderConfig[]
}

export interface SearchUser {
  id: string
  name: string
  email: string
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
  session: (signal?: AbortSignal) => request<{ user: SearchUser | null }>('/auth/session', { signal }),
  exchange: (code: string, codeVerifier: string) => post<{ user: SearchUser }>('/auth/exchange', { code, codeVerifier }),
  logout: () => post<void>('/auth/logout'),
  config: (signal?: AbortSignal) => request<SearchConfig>('/config', { signal }),
  search: (input: SearchInput, signal?: AbortSignal) => post<SearchResponse>('/query', input, signal),
}
