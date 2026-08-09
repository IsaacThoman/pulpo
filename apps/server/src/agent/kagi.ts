const KAGI_API_BASE = 'https://kagi.com/api/v1'

export const KAGI_SEARCH_COST_MICROS = 12_000
export const KAGI_EXTRACT_COST_MICROS = 4_000

type KagiMeta = { trace?: string; ms?: number }
type KagiSearchResult = { url: string; title: string; snippet?: string; time?: string }
type KagiSearchResponse = { meta?: KagiMeta; data?: Record<string, KagiSearchResult[]>; error?: Array<{ message?: string }> }
type KagiExtractResponse = { meta?: KagiMeta; data?: Array<{ url: string; markdown?: string | null; error?: string }>; error?: Array<{ message?: string }> }

export interface KagiSearchInput {
  query: string
  limit?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  timeRelative?: 'day' | 'week' | 'month'
}

export interface KagiResult {
  output: string
  trace?: string
  emptyReason?: string
}

function errorMessage(status: number, payload: unknown): string {
  const messages = (payload as { error?: Array<{ message?: unknown }> } | null)?.error
    ?.flatMap((item) => typeof item.message === 'string' ? [item.message] : [])
  return messages?.length ? messages.join('; ') : `Kagi API returned ${status}`
}

function cleanDomains(value: string[] | undefined): string[] | undefined {
  const domains = value?.map((item) => item.trim().toLowerCase()).filter((item) => /^[a-z0-9.-]+$/.test(item)).slice(0, 20)
  return domains?.length ? domains : undefined
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export class KagiClient {
  constructor(private readonly apiKey: string, private readonly timeoutMs = 15_000) {}

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${KAGI_API_BASE}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: combineSignals(signal, this.timeoutMs),
    })
    const payload = await response.json().catch(() => null) as T | null
    if (!response.ok) throw new Error(errorMessage(response.status, payload))
    if (!payload) throw new Error('Kagi API returned an empty response')
    return payload
  }

  async search(input: KagiSearchInput, signal?: AbortSignal): Promise<KagiResult> {
    const limit = Math.min(20, Math.max(1, Math.floor(input.limit ?? 10)))
    const sitesIncluded = cleanDomains(input.includeDomains)
    const sitesExcluded = cleanDomains(input.excludeDomains)
    const payload = await this.post<KagiSearchResponse>('/search', {
      query: input.query.trim(),
      workflow: 'search',
      format: 'json',
      limit,
      safe_search: true,
      ...((sitesIncluded || sitesExcluded || input.timeRelative) ? { lens: {
        ...(sitesIncluded ? { sites_included: sitesIncluded } : {}),
        ...(sitesExcluded ? { sites_excluded: sitesExcluded } : {}),
        ...(input.timeRelative ? { time_relative: input.timeRelative } : {}),
      } } : {}),
    }, signal)
    const results = Object.entries(payload.data ?? {}).flatMap(([kind, rows]) => (
      Array.isArray(rows) ? rows.map((row) => ({ kind, ...row })) : []
    )).filter((row) => row.url && row.title).slice(0, limit)
    if (!results.length) return { output: '', trace: payload.meta?.trace, emptyReason: 'no search results' }
    const output = results.map((row, index) => [
      `${index + 1}. [${row.title}](${row.url})`,
      `   Type: ${row.kind}${row.time ? ` · Date: ${row.time}` : ''}`,
      ...(row.snippet ? [`   ${row.snippet.replace(/\s+/g, ' ').trim()}`] : []),
    ].join('\n')).join('\n\n')
    return { output, trace: payload.meta?.trace }
  }

  async extract(url: string, maxBytes: number, signal?: AbortSignal): Promise<KagiResult> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error('web_fetch requires a public HTTPS URL')
    const payload = await this.post<KagiExtractResponse>('/extract', {
      pages: [{ url: parsed.toString() }],
      format: 'json',
    }, signal)
    const page = payload.data?.[0]
    if (!page?.markdown) return {
      output: '',
      trace: payload.meta?.trace,
      emptyReason: page?.error || errorMessage(502, payload),
    }
    const bytes = Buffer.from(page.markdown, 'utf8')
    const truncated = bytes.byteLength > maxBytes
    const markdown = truncated ? bytes.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/u, '') : page.markdown
    return {
      output: [`Source: ${page.url}`, '', markdown, ...(truncated ? ['', `[Content truncated at ${maxBytes} bytes]`] : [])].join('\n'),
      trace: payload.meta?.trace,
    }
  }
}
