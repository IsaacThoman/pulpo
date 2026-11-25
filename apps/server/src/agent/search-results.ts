import type { SearchDateRange } from '@pulpo/contracts/search'
import { isIP } from 'node:net'

export const basicSearchCategories = ['web', 'news', 'images'] as const
export const searchCategories = [...basicSearchCategories, 'videos', 'podcasts'] as const
export type BasicSearchCategory = typeof basicSearchCategories[number]
export type SearchCategory = typeof searchCategories[number]
export type SearchDate = 'day' | 'week' | 'month' | 'year'

export interface ProviderSearchInput {
  query: string
  limit?: number
  page?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  timeRelative?: SearchDate
  dateRange?: SearchDateRange
  category?: SearchCategory
  region?: string
  safeSearch?: boolean
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
  viewCount?: number
  publishedAt?: string
}

export interface SearchKnowledge {
  title: string
  summary: string
  url: string
  facts: Array<{ label: string; value: string }>
}

export interface SearchResults {
  results: SearchResult[]
  hasMore?: boolean
  related?: string[]
  answer?: { title: string; snippet: string; url?: string }
  knowledge?: SearchKnowledge
  podcastShows?: SearchResult[]
}

export function searchQueryTokens(query: string): string[] {
  return query.match(/(?:[^\s"]+|"(?:\\.|[^"\\])*(?:"|$))+/g) ?? []
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
export function resultSnippet(value: unknown, limit = 245, query?: string): string {
  if (typeof value !== 'string') return ''
  const lines = value.slice(0, maxResultTextLength)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/^[ \t]*(?:`{3,}|~{3,})[ \t]*[\w.+-]*[ \t]*$/gm, ' ')
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
    .replace(/`{3,}|¶/g, '').replace(/\s+/g, ' ').trim()
  const leading = shortenResultText(text, limit)
  return query && text.length > limit ? relevantExcerpt(text, query, leading, limit) : leading
}

const excerptWord = /[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*/gu
const weakTerms = new Set(['and', 'are', 'can', 'does', 'for', 'from', 'how', 'near', 'not', 'the', 'this', 'was', 'what', 'when', 'where', 'which', 'with'])

function relevantExcerpt(text: string, query: string, leading: string, limit: number): string {
  const terms = searchQueryTokens(query).filter(term => !/^-?[a-z][a-z-]*:/i.test(term))
    .join(' ').toLowerCase().match(excerptWord) ?? []
  const wanted = new Set(terms.filter(word => word.length > 2 && !weakTerms.has(word)).slice(0, 14))
  if (!wanted.size) return leading

  function score(candidate: string) {
    const matches = new Set(candidate.toLowerCase().match(excerptWord))
    return [...wanted].reduce((total, word) => matches.has(word) ? total + (/[._]/.test(word) ? 2 : 1) : total, 0)
  }

  let best = leading
  let bestScore = score(leading)
  let previous = 0
  let considered = 0
  for (const hit of text.slice(0, 8_000).matchAll(excerptWord)) {
    if (!wanted.has(hit[0].toLowerCase()) || hit.index < limit / 2 || hit.index - previous < 36) continue
    const start = text.lastIndexOf(' ', hit.index - 42) + 1
    const candidate = '… ' + shortenResultText(text.slice(start), limit - 2)
    const candidateScore = score(candidate)
    if (candidateScore > bestScore) {
      best = candidate
      bestScore = candidateScore
    }
    previous = hit.index
    if (++considered >= 32) break
  }
  return best
}

export function shortenResultText(text: string, limit: number): string {
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

interface RawSearchResult {
  url?: unknown
  title?: unknown
  snippet?: unknown
  imageUrl?: unknown
  thumbnailUrl?: unknown
  imageWidth?: unknown
  imageHeight?: unknown
  duration?: unknown
  creatorName?: unknown
  viewCount?: unknown
  publishedAt?: unknown
}

function isImageDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000
}

export function normalizeResult(row: RawSearchResult, query?: string): SearchResult | null {
  const url = resultUrl(row.url)
  const title = resultText(row.title, 300)
  if (!url || !title) return null
  const originalImageUrl = resultUrl(row.imageUrl, true)
  const thumbnailUrl = resultUrl(row.thumbnailUrl, true)
  const imageUrl = originalImageUrl ?? thumbnailUrl
  const imageDimensions = originalImageUrl && isImageDimension(row.imageWidth) && isImageDimension(row.imageHeight)
    ? { width: row.imageWidth, height: row.imageHeight }
    : undefined
  const duration = typeof row.duration === 'string' && /^\d{1,4}:[0-5]\d(?::[0-5]\d)?$/.test(row.duration) ? row.duration : undefined
  const creatorName = resultText(row.creatorName, 120)
  const viewCount = typeof row.viewCount === 'string' && /^\d{1,15}$/.test(row.viewCount) ? Number(row.viewCount) : row.viewCount
  const publishedAt = resultText(row.publishedAt, 50)
  return {
    url, title, snippet: resultSnippet(row.snippet, 245, query),
    ...(imageUrl ? { imageUrl } : {}),
    ...(thumbnailUrl && thumbnailUrl !== imageUrl ? { thumbnailUrl } : {}),
    ...(imageDimensions ? { imageDimensions } : {}),
    ...(duration ? { duration } : {}),
    ...(creatorName ? { creatorName } : {}),
    ...(typeof viewCount === 'number' && Number.isSafeInteger(viewCount) && viewCount >= 0 ? { viewCount } : {}),
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
