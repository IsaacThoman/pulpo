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

const maxResultTextLength = 20_000
const markdownLink = /(!?)\[([^[\]\r\n]*)\]\((?:[^()\r\n]|\([^()\r\n]*\))*\)/g

export function resultText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, maxResultTextLength)
    .replace(/<(?:br|hr)\s*\/?>|<\/(?:p|div|li|h[1-6])\s*>/gi, ' ')
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

/** Turn compact provider snippets or scraped page previews into a short, plain-text excerpt. */
export function resultSnippet(value: unknown, limit = 245): string {
  if (typeof value !== 'string') return ''
  const lines = value.slice(0, maxResultTextLength)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    // Some previews put the entire link menu and heading on one line.
    .replace(/\)\s+(?=#{1,6}[ \t])/g, ')\n')
    .split(/\r?\n/)

  const paragraphs: string[] = []
  const headings: string[] = []
  for (const line of lines) {
    const block = line.trim()
    if (!block || /^(?:\[[^\]]+\]:|[-=*_]{3,}\s*$)/.test(block)) continue
    const heading = /^#{1,6}\s+(.+?)(?:\s+#+)?$/.exec(block)
    const body = (heading?.[1] ?? block).replace(/^(?:>\s*|(?:[-+*]|\d+[.)])\s+)/, '')
    // Discard link-only menu entries and inline rows of links, keeping anchor text in prose.
    if (body.includes('](') && !body.replace(markdownLink, '').replace(/[\s\p{P}\p{S}]/gu, '')) continue
    const text = body
      .replace(markdownLink, (_match, image: string, label: string) => image ? '' : label)
      .replace(markdownLink, (_match, image: string, label: string) => image ? '' : label)
      .replace(/\*\*([^*\r\n]+)\*\*|__([^_\r\n]+)__|~~([^~\r\n]+)~~|`{1,3}([^`]+)`{1,3}/g,
        (_match, a: string, b: string, c: string, d: string) => a ?? b ?? c ?? d)
      .replace(/\\([\\`*_[\]#~])/g, '$1')
    if (heading) headings.push(text)
    else paragraphs.push(text)
  }

  const text = resultText((paragraphs.length ? paragraphs : headings).join(' '), maxResultTextLength)
  if (text.length <= limit) return text
  const prefix = text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '')
  const space = prefix.lastIndexOf(' ')
  return (space >= limit * 0.7 ? prefix.slice(0, space) : prefix).trimEnd() + '…'
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
    url, title, snippet: resultSnippet(row.snippet),
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
