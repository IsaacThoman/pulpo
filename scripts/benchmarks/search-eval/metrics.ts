import type { EvalSerpResult, LatencyStats } from './types.ts'

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref', 'ref_src',
  'ref_url', 'source', 's', 'si', 'spm', 'igshid', 'mkt_tok', 'yclid', '_hsenc', '_hsmi',
])

/** Known SEO-farm, scraper-clone, and AI-slop aggregator domains used for deterministic baseline telemetry. */
export const KNOWN_SLOP_DOMAINS = new Set([
  'pinterest.com',
  'quora.com',
  'w3schools.com',
  'geeksforgeeks.org',
  'javatpoint.com',
  'tutorialspoint.com',
  'bobbyhadz.com',
  'copyprogramming.com',
  'codesandbox-clone.example',
  'ai-listicle-farm.example',
  'seo-scraper-hub.example',
  'best-top10-reviews.example',
  'affiliate-buying-guide.example',
  'content-mill-daily.example',
])

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(?:www|m|mobile|amp)\./, '')
  } catch {
    return ''
  }
}

export function matchesDomainList(url: string, domains: readonly string[]): boolean {
  const host = extractDomain(url)
  if (!host) return false
  return domains.some((raw) => {
    const target = raw.toLowerCase().replace(/^(?:www|m|mobile|amp)\./, '')
    return host === target || host.endsWith(`.${target}`)
  })
}

/**
 * Normalizes a URL for canonical deduplication:
 * strips tracking query params, hash fragments, www./m./mobile./amp. prefixes,
 * default ports, trailing slashes, and /amp path suffixes.
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase().replace(/^(?:www|m|mobile|amp)\./, '')
    const keptParams: Array<[string, string]> = []
    for (const [key, value] of parsed.searchParams.entries()) {
      const lower = key.toLowerCase()
      if (TRACKING_PARAMS.has(lower) || lower.startsWith('utm_')) continue
      keptParams.push([key, value])
    }
    keptParams.sort(([a], [b]) => a.localeCompare(b))
    const query = keptParams.length
      ? `?${keptParams.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
      : ''
    let pathname = parsed.pathname.replace(/\/amp\/?$/i, '/').replace(/\/+$/, '') || '/'
    if (pathname !== '/' && pathname.endsWith('/index.html')) {
      pathname = pathname.slice(0, -'/index.html'.length) || '/'
    }
    return `${host}${pathname}${query}`
  } catch {
    return rawUrl.trim().toLowerCase()
  }
}

/** Computes fraction of duplicate URLs present in a result list after canonicalization. */
export function canonicalDuplicateRate(results: readonly EvalSerpResult[]): number {
  if (results.length <= 1) return 0
  const seen = new Set<string>()
  let duplicates = 0
  for (const item of results) {
    const key = canonicalizeUrl(item.url)
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }
  return duplicates / results.length
}

/**
 * Graded Normalized Discounted Cumulative Gain @ K.
 * Uses exponential gain: (2^g - 1) / log2(rank + 1) where rank is 1-indexed.
 */
export function ndcgAtK(grades: readonly number[], k = 10): number {
  const slice = grades.slice(0, k)
  if (!slice.length) return 0
  const dcg = (items: readonly number[]) =>
    items.reduce((sum, grade, index) => sum + ((2 ** Math.max(0, grade)) - 1) / Math.log2(index + 2), 0)
  const ideal = [...slice].sort((a, b) => b - a)
  const idealScore = dcg(ideal)
  if (idealScore === 0) return 0
  return dcg(slice) / idealScore
}

/** Mean Reciprocal Rank for a single query given graded relevance scores. */
export function reciprocalRank(grades: readonly number[], relevantThreshold = 2): number {
  const idx = grades.findIndex(grade => grade >= relevantThreshold)
  return idx === -1 ? 0 : 1 / (idx + 1)
}

export function percentile(sortedValues: readonly number[], p: number): number {
  if (!sortedValues.length) return 0
  if (sortedValues.length === 1) return sortedValues[0]!
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1))
  return sortedValues[index]!
}

export function summarizeLatencies(samples: readonly number[]): LatencyStats {
  if (!samples.length) {
    return { count: 0, meanMs: 0, p50Ms: 0, p90Ms: 0, p95Ms: 0, maxMs: 0 }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, value) => acc + value, 0)
  return {
    count: sorted.length,
    meanMs: Number((sum / sorted.length).toFixed(2)),
    p50Ms: Number(percentile(sorted, 50).toFixed(2)),
    p90Ms: Number(percentile(sorted, 90).toFixed(2)),
    p95Ms: Number(percentile(sorted, 95).toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1]!.toFixed(2)),
  }
}

function rankWithTies(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const ranks = new Array<number>(values.length)
  for (let i = 0; i < indexed.length;) {
    let j = i
    while (j + 1 < indexed.length && indexed[j + 1]!.value === indexed[i]!.value) j += 1
    const avgRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k += 1) ranks[indexed[k]!.index] = avgRank
    i = j + 1
  }
  return ranks
}

/** Spearman rank correlation coefficient between two equal-length score arrays. */
export function spearmanCorrelation(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0
  const rx = rankWithTies(xs)
  const ry = rankWithTies(ys)
  const meanX = rx.reduce((a, b) => a + b, 0) / rx.length
  const meanY = ry.reduce((a, b) => a + b, 0) / ry.length
  let num = 0
  let denX = 0
  let denY = 0
  for (let i = 0; i < rx.length; i += 1) {
    const dx = rx[i]! - meanX
    const dy = ry[i]! - meanY
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }
  const den = Math.sqrt(denX * denY)
  return den === 0 ? 0 : num / den
}

/** Quadratic-weighted Cohen's kappa for ordinal grades in [0..maxGrade]. */
export function quadraticWeightedKappa(xs: readonly number[], ys: readonly number[], maxGrade = 3): number {
  const n = xs.length
  if (n === 0 || xs.length !== ys.length) return 0
  const size = maxGrade + 1
  const observed = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  const histX = new Array<number>(size).fill(0)
  const histY = new Array<number>(size).fill(0)
  for (let i = 0; i < n; i += 1) {
    const x = Math.min(maxGrade, Math.max(0, Math.round(xs[i]!)))
    const y = Math.min(maxGrade, Math.max(0, Math.round(ys[i]!)))
    observed[x]![y]! += 1
    histX[x]! += 1
    histY[y]! += 1
  }
  let num = 0
  let den = 0
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      const weight = ((i - j) ** 2) / (maxGrade ** 2)
      const expected = (histX[i]! * histY[j]!) / n
      num += weight * observed[i]![j]!
      den += weight * expected
    }
  }
  return den === 0 ? 1 : 1 - num / den
}

export function isKnownSlopUrl(url: string, extraSlopDomains: readonly string[] = []): boolean {
  const domain = extractDomain(url)
  if (!domain) return false
  if (KNOWN_SLOP_DOMAINS.has(domain)) return true
  for (const slop of KNOWN_SLOP_DOMAINS) {
    if (domain.endsWith(`.${slop}`)) return true
  }
  return matchesDomainList(url, extraSlopDomains)
}
