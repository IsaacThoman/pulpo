import { truncateUtf8 } from './output.js'
import {
  normalizeResult, resultSnippet, resultText, resultUrl, searchQueryTokens, shortenResultText, uniqueResults,
  type ProviderSearchInput, type SearchCategory, type SearchKnowledge, type SearchResults,
} from './search-results.js'

const KAGI_API_BASE = 'https://kagi.com/api/v1'

export const KAGI_SEARCH_COST_MICROS = 12_000
export const KAGI_EXTRACT_COST_MICROS = 4_000
export const KAGI_MAX_SEARCH_PAGE = 10
const resultGroups: Record<SearchCategory, string> = {
  web: 'search',
  news: 'news',
  images: 'image',
  videos: 'video',
  podcasts: 'podcast',
}

type KagiMeta = { trace?: string; ms?: number }
type KagiSearchResult = {
  url: string
  title: string
  snippet?: string
  time?: string
  image?: { url?: string; width?: number; height?: number }
  props?: {
    question?: string
    query?: string
    duration?: string
    creator_name?: string
    thumbnail?: { url?: string }
    infobox?: unknown
  }
}
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

/** A fetched page whose `output` is its whole Markdown, before anything trims it for the model. */
export interface WebPage extends KagiResult {
  sourceUrl: string
  title?: string
  requestId?: string
}

/** What web_fetch gives the model: the page's source, then its Markdown cut at `maxBytes`. */
export function webFetchOutput(page: WebPage, maxBytes: number): WebPage {
  if (!page.output) return page
  const truncated = Buffer.byteLength(page.output, 'utf8') > maxBytes
  const content = truncated ? truncateUtf8(page.output, maxBytes) : page.output
  return {
    ...page,
    output: [`Source: ${page.sourceUrl}`, '', content, ...(truncated ? ['', `[Content truncated at ${maxBytes} bytes]`] : [])].join('\n'),
  }
}

export function publicHttpsUrl(url: string): URL {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error('web_fetch requires a public HTTPS URL')
  return parsed
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

const wikipediaHost = /^(?!www\.)[a-z]{2,3}(?:-[a-z0-9]+)*(?:\.m)?\.wikipedia\.org$/
const wikipediaNamespace = /^(?:book|category|draft|file|gadget(?:[ _]definition)?|help|image|media|mediawiki|module|portal|project|special|talk|template|timedtext|topic|user|wikipedia|wp)(?:[ _]talk)?:/i
const wikiCitation = /\s*\[\s*(?:\d+(?:\s*[,–-]\s*\d+)*|[a-z]|citation needed|note\s+\d+)\s*\]/gi
const hiddenWikiMarkup = /<!--[\s\S]*?-->|<(script|style|noscript)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>/gi
const wikiReferenceTags = /<sup\b[^<>]*\b(?:reference|cite_ref)\b[^<>]*>[\s\S]*?<\/sup\s*>/gi
const wikiTags = /<\/?[a-z](?:[^"'<>]|"[^"]*"|'[^']*')*>/gi
const wikiBlockTags = /^<(?:br|hr)\b|^<\/(?:dd|div|dt|h[1-6]|li|p|td|th|tr)\b/i

function wikipediaArticleUrl(value: unknown): string | undefined {
  const href = resultUrl(value)
  if (!href) return
  const url = new URL(href)
  if (url.protocol !== 'https:' || url.port || url.search || !wikipediaHost.test(url.hostname) || !url.pathname.startsWith('/wiki/')) return

  let article: string
  try {
    article = decodeURIComponent(url.pathname.slice('/wiki/'.length))
  } catch {
    return
  }
  if (!/[\p{L}\p{N}]/u.test(article) || /[\p{Cc}#<>[\]{}|\\?]/u.test(article) || wikipediaNamespace.test(article)) return
  url.hash = ''
  return url.href
}

function wikipediaText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  const markup = value.slice(0, 20_000)
    .replace(hiddenWikiMarkup, ' ')
    .replace(wikiReferenceTags, '')
  if (/<\/?(?:script|style|noscript)(?=[\s/>])/i.test(markup)) return ''

  const text = resultSnippet(markup.replace(wikiTags, tag => wikiBlockTags.test(tag) ? ' ' : ''), 20_000)
    .replace(wikiCitation, '')
    .replace(/\p{Cc}/gu, '')
    .trim()

  // Entity decoding can uncover markup the provider encoded inside a text field.
  if (!/[\p{L}\p{N}]/u.test(text) || /<(?:\/?[a-z]|[!?])/i.test(text)) return ''
  return shortenResultText(text, limit)
}

function wikipediaKnowledge(rows: KagiSearchResult[]): SearchKnowledge | undefined {
  for (const row of rows.slice(0, 20)) {
    const url = wikipediaArticleUrl(row?.url)
    if (!url) continue
    const title = wikipediaText(row.title, 200)
    const summary = wikipediaText(row.snippet, 800)
    if (!title || !summary) continue

    const facts: SearchKnowledge['facts'] = []
    const labels = new Set<string>()
    const entries = row.props?.infobox
    if (Array.isArray(entries)) {
      for (const entry of entries.slice(0, 30)) {
        const label = wikipediaText(entry?.key, 72)
        const value = wikipediaText(entry?.value, 300)
        const key = label.toLowerCase()
        if (!label || !value || labels.has(key)) continue
        labels.add(key)
        facts.push({ label, value })
        if (facts.length === 8) break
      }
    }
    return { title, summary, url, facts }
  }
}

export class KagiClient {
  constructor(private readonly apiKey: string, private readonly timeoutMs = 15_000) {}

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(KAGI_API_BASE + path, {
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
    const payload = await this.querySearch(input, limit, signal)
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

  async searchResults(input: ProviderSearchInput, signal?: AbortSignal): Promise<SearchResults> {
    const category = input.category ?? 'web'
    const page = input.page ?? 1
    const limit = Math.min(20, Math.max(1, Math.floor(input.limit ?? 10)))
    const payload = await this.querySearch(input, limit, signal)
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      throw new Error('Kagi search response did not contain a result set')
    }
    const group = (key: string) => Array.isArray(payload.data?.[key]) ? payload.data[key] : []
    const rows = group(resultGroups[category])
    const results = uniqueResults(rows.map((row) => normalizeResult({
      url: row?.url,
      title: row?.title,
      snippet: row?.snippet,
      imageUrl: row?.image?.url,
      thumbnailUrl: category === 'images' ? row?.props?.thumbnail?.url : undefined,
      imageWidth: category === 'images' ? row?.image?.width : undefined,
      imageHeight: category === 'images' ? row?.image?.height : undefined,
      duration: category === 'videos' || category === 'podcasts' ? row?.props?.duration : undefined,
      creatorName: category === 'videos' || category === 'podcasts' ? row?.props?.creator_name : undefined,
      publishedAt: row?.time,
    })), limit, category)
    const related = page > 1 ? [] : [...new Set([
      ...group('related_search').map((row) => resultText(row?.props?.query ?? row?.title, 200)),
      ...group('adjacent_question').map((row) => resultText(row?.props?.question ?? row?.title, 200)),
    ].filter(Boolean))].slice(0, 8)
    const directAnswer = category === 'web' && page === 1 ? group('direct_answer')[0] : undefined
    const title = resultText(directAnswer?.title, 300)
    const snippet = resultSnippet(directAnswer?.snippet, 500)
    const url = resultUrl(directAnswer?.url)
    const knowledge = category === 'web' && page === 1 && !input.timeRelative && !input.region
      && !input.includeDomains?.length && !input.excludeDomains?.length
      && !searchQueryTokens(input.query).some(token => /^[()+-]*site:[^)\s]/i.test(token))
      ? wikipediaKnowledge(group('infobox')) : undefined
    return {
      results,
      // The API supplies no total or cursor, but can accept an additional page after a full result group.
      hasMore: page < KAGI_MAX_SEARCH_PAGE && rows.length >= limit,
      ...(related.length ? { related } : {}),
      ...(title && snippet ? { answer: { title, snippet, ...(url ? { url } : {}) } } : {}),
      ...(knowledge ? { knowledge } : {}),
    }
  }

  private async querySearch(input: ProviderSearchInput, limit: number, signal?: AbortSignal): Promise<KagiSearchResponse> {
    const sitesIncluded = cleanDomains(input.includeDomains)
    const sitesExcluded = cleanDomains(input.excludeDomains)
    const timeRelative = input.timeRelative === 'year' ? undefined : input.timeRelative
    const after = input.timeRelative === 'year' ? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10) : undefined
    const payload = await this.post<KagiSearchResponse>('/search', {
      query: input.query.trim(),
      workflow: input.category && input.category !== 'web' ? input.category : 'search',
      format: 'json',
      limit,
      ...(input.page && input.page > 1 ? { page: input.page } : {}),
      filters: { safe_search: true, ...(input.region ? { region: input.region } : {}), ...(after ? { after } : {}) },
      ...((sitesIncluded || sitesExcluded || timeRelative) ? { lens: {
        ...(sitesIncluded ? { sites_included: sitesIncluded } : {}),
        ...(sitesExcluded ? { sites_excluded: sitesExcluded } : {}),
        ...(timeRelative ? { time_relative: timeRelative } : {}),
      } } : {}),
    }, signal)
    if (payload.error?.length) throw new Error(errorMessage(502, payload))
    return payload
  }

  async extract(url: string, maxBytes: number, signal?: AbortSignal): Promise<KagiResult> {
    return webFetchOutput(await this.fetchPage(url, signal), maxBytes)
  }

  async fetchPage(url: string, signal?: AbortSignal): Promise<WebPage> {
    const parsed = publicHttpsUrl(url)
    const payload = await this.post<KagiExtractResponse>('/extract', {
      pages: [{ url: parsed.toString() }],
      format: 'json',
    }, signal)
    const page = payload.data?.[0]
    if (!page?.markdown) return {
      output: '',
      sourceUrl: page?.url || parsed.toString(),
      trace: payload.meta?.trace,
      emptyReason: page?.error || errorMessage(502, payload),
    }
    return { output: page.markdown, sourceUrl: page.url || parsed.toString(), trace: payload.meta?.trace }
  }
}
