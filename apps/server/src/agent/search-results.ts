import { isIP } from 'node:net'

export type SearchCategory = 'web' | 'news' | 'images'
export type SearchDate = 'day' | 'week' | 'month' | 'year'

export interface ProviderSearchInput {
  query: string
  limit?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  timeRelative?: SearchDate
  category?: SearchCategory
  region?: string
}

export interface SearchResult {
  url: string
  title: string
  snippet: string
  imageUrl?: string
  publishedAt?: string
}

export interface SearchResults {
  results: SearchResult[]
  related?: string[]
  answer?: { title: string; snippet: string; url?: string }
}

const entities = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '],
  ['lsquo', '‘'], ['rsquo', '’'], ['ldquo', '“'], ['rdquo', '”'], ['ndash', '–'], ['mdash', '—'], ['hellip', '…'],
])

export function resultText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, 20_000)
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*|\/?)>/gi, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
      if (!key.startsWith('#')) return entities.get(key) ?? entity
      const hex = key[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10)
      return codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity
    })
    .replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function resultUrl(value: unknown, image = false): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return
  const url = URL.parse(value)
  if (!url || url.username || url.password || (url.protocol !== 'http:' && url.protocol !== 'https:')) return
  if (image) {
    const hostname = url.hostname.replace(/\.$/, '')
    if (url.protocol !== 'https:' || !hostname.includes('.') || isIP(hostname) || /\.(?:local|localhost|internal)$/.test(hostname)) return
  }
  return url.href
}

export function normalizeResult(row: { url?: unknown; title?: unknown; snippet?: unknown; imageUrl?: unknown; publishedAt?: unknown }): SearchResult | null {
  const url = resultUrl(row.url)
  const title = resultText(row.title, 300)
  if (!url || !title) return null
  const imageUrl = resultUrl(row.imageUrl, true)
  const publishedAt = resultText(row.publishedAt, 50)
  return {
    url, title, snippet: resultText(row.snippet, 2400),
    ...(imageUrl ? { imageUrl } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  }
}

export function uniqueResults(rows: Array<SearchResult | null>, limit: number, category: SearchCategory): SearchResult[] {
  const seen = new Set<string>()
  const results: SearchResult[] = []
  for (const row of rows) {
    if (!row || (category === 'images' && !row.imageUrl)) continue
    const key = category === 'images' ? row.imageUrl! : row.url
    if (seen.has(key)) continue
    seen.add(key)
    results.push(row)
    if (results.length === limit) break
  }
  return results
}
