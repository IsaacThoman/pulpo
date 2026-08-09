import type { KagiSearchInput, KagiResult } from './kagi.js'
import { truncateUtf8 } from './output.js'

export const FIRECRAWL_DEFAULT_API_BASE = 'https://api.firecrawl.dev/v2'

type FirecrawlSearchResult = {
  title?: string
  description?: string
  url?: string
}

type FirecrawlSearchResponse = {
  success?: boolean
  data?: { web?: FirecrawlSearchResult[] }
  id?: string
  error?: string
  message?: string
}

type FirecrawlScrapeResponse = {
  success?: boolean
  data?: {
    markdown?: string | null
    metadata?: { sourceURL?: string; url?: string; error?: string }
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
    const includeDomains = cleanDomains(input.includeDomains)
    const excludeDomains = cleanDomains(input.excludeDomains)
    const query = includeDomains && excludeDomains
      ? `${input.query.trim()} ${excludeDomains.map((domain) => `-site:${domain}`).join(' ')}`
      : input.query.trim()
    const payload = await this.post<FirecrawlSearchResponse>('/search', {
      query,
      limit,
      sources: ['web'],
      safe: true,
      ...(includeDomains ? { includeDomains } : {}),
      ...(!includeDomains && excludeDomains ? { excludeDomains } : {}),
      ...(input.timeRelative ? { tbs: `qdr:${{ day: 'd', week: 'w', month: 'm' }[input.timeRelative]}` } : {}),
    }, signal)
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

  async extract(url: string, maxBytes: number, maxAgeSeconds: number, signal?: AbortSignal): Promise<FirecrawlResult> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error('web_fetch requires a public HTTPS URL')
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
    if (!markdown?.trim()) return {
      output: '',
      requestId: payload.id,
      emptyReason: payload.data?.metadata?.error || 'missing page content',
    }
    const truncated = Buffer.byteLength(markdown, 'utf8') > maxBytes
    const content = truncated ? truncateUtf8(markdown, maxBytes) : markdown
    const sourceUrl = payload.data?.metadata?.sourceURL || payload.data?.metadata?.url || parsed.toString()
    return {
      output: [`Source: ${sourceUrl}`, '', content, ...(truncated ? ['', `[Content truncated at ${maxBytes} bytes]`] : [])].join('\n'),
      requestId: payload.id,
    }
  }
}
