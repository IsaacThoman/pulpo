import { searchDateRange } from '@pulpo/contracts/search'
import { publicHttpsUrl, webFetchOutput, type KagiSearchInput, type KagiResult, type WebPage } from './kagi.js'
import { normalizeResult, resultSnippet, searchTerms, textTerms, uniqueResults, type BasicSearchCategory, type ProviderSearchInput, type SearchResults } from './search-results.js'

export const FIRECRAWL_DEFAULT_API_BASE = 'https://api.firecrawl.dev/v2'
/** Firecrawl's own search timeout ends this much before the caller's deadline. */
const FIRECRAWL_TIMEOUT_MARGIN_MS = 500

type FirecrawlSearchInput = Omit<ProviderSearchInput, 'category' | 'page'> & { category?: BasicSearchCategory }

type FirecrawlSearchResult = {
  title?: string
  description?: string
  snippet?: string
  url?: string
  imageUrl?: string
  imageWidth?: number
  imageHeight?: number
  date?: string
  metadata?: {
    publishedTime?: unknown
    'article:published_time'?: unknown
    datePublished?: unknown
    description?: string
    ogDescription?: string
    ogImage?: string
  }
}

type FirecrawlSearchResponse = {
  success?: boolean
  data?: Partial<Record<BasicSearchCategory, FirecrawlSearchResult[]>>
  id?: string
  error?: string
  message?: string
}

type FirecrawlScrapeResponse = {
  success?: boolean
  data?: {
    markdown?: string | null
    metadata?: { sourceURL?: string; url?: string; title?: string; error?: string }
  }
  id?: string
  error?: string
  message?: string
}

export interface FirecrawlResult extends KagiResult {
  requestId?: string
}

export class FirecrawlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirecrawlError'
  }
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function cleanDomains(value: string[] | undefined): string[] | undefined {
  const domains = value?.map((item) => item.trim().toLowerCase()).filter((item) => /^[a-z0-9.-]+$/.test(item)).slice(0, 20)
  return domains?.length ? domains : undefined
}

function apiError(payload: FirecrawlSearchResponse | FirecrawlScrapeResponse | null, status: number): string {
  return payload?.error || payload?.message || `Firecrawl API returned ${status}`
}

const previewLimit = 245

// 0: too short or mostly symbols, 1: mostly table rows, 2: prose.
function previewQuality(text: string) {
  const visible = text.replace(/\s/g, '')
  if (text.length < 20 || (visible.match(/\p{L}/gu)?.length ?? 0) < visible.length * 0.6) return 0
  return (text.match(/ ; /g)?.length ?? 0) >= 2 ? 1 : 2
}

// Web results carry query highlights (Markdown that may include tables) in description; news results use snippet.
function searchPreview(row: FirecrawlSearchResult | undefined, query?: string) {
  const rawSnippet = typeof row?.snippet === 'string' ? row.snippet.trim() : ''
  const snippet = resultSnippet(rawSnippet, previewLimit, query)
  const description = resultSnippet(row?.description, previewLimit, query)
  if (!snippet || !description || snippet === description) return snippet || description
  const snippetQuality = previewQuality(snippet)
  const descriptionQuality = previewQuality(description)
  if (snippetQuality !== descriptionQuality) return snippetQuality > descriptionQuality ? snippet : description
  const combined = descriptionQuality === 2 && query && combinedPreview(description, rawSnippet, query)
  if (combined) return combined
  return rawSnippet.length > 300 ? description : snippet
}

// A one-line summary plus the part of the page that mentions what the summary leaves out.
function combinedPreview(description: string, rawSnippet: string, query: string) {
  if (description.length > 140 || description.endsWith('…')) return
  const room = previewLimit - description.length - 1
  const excerpt = resultSnippet(rawSnippet, room, query)
  const known = textTerms(description)
  const adds = [...textTerms(excerpt)].some(term => searchTerms(query).has(term) && !known.has(term))
  if (excerpt.length >= 40 && previewQuality(excerpt) && adds) return `${description} ${excerpt}`
}

function publisherPreview(row: FirecrawlSearchResult) {
  return [row.metadata?.ogDescription, row.metadata?.description, row.description, row.snippet]
    .find(value => typeof value === 'string' && value.trim() && value.length <= 600 && !/\]\(|\\\s/.test(value))
}

function providerDate(date: string) {
  const [year, month, day] = date.split('-')
  return `${month}/${day}/${year}`
}

function publisherDate(metadata: FirecrawlSearchResult['metadata']) {
  for (const value of [metadata?.['article:published_time'], metadata?.datePublished, metadata?.publishedTime]) {
    if (typeof value !== 'string') continue
    const date = value.slice(0, 10)
    const calendarDate = value === date
    if (!searchDateRange(date, date) || (!calendarDate && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value))) continue
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp) && timestamp <= Date.now() + 86_400_000) return calendarDate ? date : new Date(timestamp).toISOString()
  }
}

export function firecrawlCloudRequiresApiKey(baseUrl: string): boolean {
  return new URL(baseUrl).hostname.toLowerCase() === 'api.firecrawl.dev'
}

export class FirecrawlClient {
  private readonly baseUrl: string

  constructor(baseUrl: string, private readonly apiKey?: string, private readonly timeoutMs = 30_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  private async post<T extends FirecrawlSearchResponse | FirecrawlScrapeResponse>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: combineSignals(signal, this.timeoutMs),
    })
    const payload = await response.json().catch(() => null) as T | null
    if (!response.ok || payload?.success === false) throw new FirecrawlError(apiError(payload, response.status))
    if (!payload) throw new FirecrawlError('Firecrawl API returned an empty response')
    return payload
  }

  async search(input: KagiSearchInput, signal?: AbortSignal): Promise<FirecrawlResult> {
    const limit = Math.min(20, Math.max(1, Math.floor(input.limit ?? 10)))
    const payload = await this.querySearch(input, limit, signal)
    const rows = (payload.data?.web ?? []).filter((row): row is Required<Pick<FirecrawlSearchResult, 'title' | 'url'>> & FirecrawlSearchResult => (
      typeof row.title === 'string' && Boolean(row.title.trim()) && typeof row.url === 'string' && Boolean(row.url.trim())
    )).slice(0, limit)
    if (!rows.length) return {
      output: '', requestId: payload.id, emptyReason: 'no search results',
    }
    return {
      output: rows.map((row, index) => [
        `${index + 1}. [${row.title}](${row.url})`,
        '   Type: web',
        ...(row.description ? [`   ${row.description.replace(/\s+/g, ' ').trim()}`] : []),
      ].join('\n')).join('\n\n'),
      requestId: payload.id,
    }
  }

  async searchResults(input: ProviderSearchInput, signal?: AbortSignal): Promise<SearchResults> {
    const category = input.category ?? 'web'
    if (category === 'videos' || category === 'podcasts' || (input.page ?? 1) !== 1) {
      throw new FirecrawlError('Firecrawl does not support this search type or page')
    }
    const includePublisherMetadata = category === 'news' && input.includePublisherMetadata
    const limit = Math.min(includePublisherMetadata ? 10 : 20, Math.max(1, Math.floor(input.limit ?? 10)))
    const payload = await this.querySearch({ ...input, category }, limit, signal)
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      throw new FirecrawlError('Firecrawl search response did not contain a result set')
    }
    const group = payload.data[category]
    const rows = Array.isArray(group) ? group : []
    return {
      results: uniqueResults(rows.map((row) => normalizeResult({
        url: row?.url,
        title: row?.title,
        snippet: includePublisherMetadata && row ? publisherPreview(row) : searchPreview(row, category === 'images' ? undefined : input.query),
        imageUrl: row?.imageUrl || row?.metadata?.ogImage,
        imageWidth: category === 'images' ? row?.imageWidth : undefined,
        imageHeight: category === 'images' ? row?.imageHeight : undefined,
        // Search dates can reflect indexing or updates rather than publication.
        publishedAt: category === 'news' ? (includePublisherMetadata ? publisherDate(row?.metadata) : undefined) : row?.date,
      }, category === 'images' ? undefined : input.query)), limit, category),
    }
  }

  private async querySearch(input: FirecrawlSearchInput, limit: number, signal?: AbortSignal): Promise<FirecrawlSearchResponse> {
    const includeDomains = cleanDomains(input.includeDomains)
    const excludeDomains = cleanDomains(input.excludeDomains)
    const query = includeDomains && excludeDomains
      ? `${input.query.trim()} ${excludeDomains.map((domain) => `-site:${domain}`).join(' ')}`
      : input.query.trim()
    const tbs = input.dateRange
      ? `cdr:1,cd_min:${providerDate(input.dateRange.from)},cd_max:${providerDate(input.dateRange.to)}`
      : input.timeRelative ? `qdr:${{ day: 'd', week: 'w', month: 'm', year: 'y' }[input.timeRelative]}` : undefined
    return await this.post<FirecrawlSearchResponse>('/search', {
      query,
      limit,
      sources: [input.category ?? 'web'],
      safe: input.safeSearch ?? true,
      ...(includeDomains ? { includeDomains } : {}),
      ...(!includeDomains && excludeDomains ? { excludeDomains } : {}),
      ...(tbs ? { tbs } : {}),
      ...(input.region ? { country: input.region } : {}),
      // Stop just before the caller gives up, so Firecrawl ends the work (and its credit use) too.
      ...(input.timeoutMs ? { timeout: Math.max(1_000, Math.floor(input.timeoutMs - FIRECRAWL_TIMEOUT_MARGIN_MS)) } : {}),
      ...(input.category === 'news' && input.includePublisherMetadata ? {
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      } : {}),
    }, signal)
  }

  async extract(url: string, maxBytes: number, maxAgeSeconds: number, signal?: AbortSignal): Promise<FirecrawlResult> {
    return webFetchOutput(await this.fetchPage(url, maxAgeSeconds, signal), maxBytes)
  }

  async fetchPage(url: string, maxAgeSeconds: number, signal?: AbortSignal): Promise<WebPage> {
    const parsed = publicHttpsUrl(url)
    const payload = await this.post<FirecrawlScrapeResponse>('/scrape', {
      url: parsed.toString(),
      formats: ['markdown'],
      onlyMainContent: true,
      maxAge: maxAgeSeconds * 1000,
      proxy: 'auto',
      blockAds: true,
      removeBase64Images: true,
    }, signal)
    const markdown = payload.data?.markdown
    const metadata = payload.data?.metadata
    const sourceUrl = metadata?.sourceURL || metadata?.url || parsed.toString()
    if (!markdown?.trim()) return {
      output: '',
      sourceUrl,
      requestId: payload.id,
      emptyReason: metadata?.error || 'missing page content',
    }
    return {
      output: markdown,
      sourceUrl,
      ...(metadata?.title?.trim() ? { title: metadata.title.trim() } : {}),
      requestId: payload.id,
    }
  }
}
