import { searchQueryTokens, type SearchResults } from '../agent/search-results.js'

export const searchScopes = ['developer', 'discussions', 'academic'] as const
type SearchScope = typeof searchScopes[number]

const scopeHosts: Record<SearchScope, readonly string[]> = {
  developer: [
    'developer.mozilla.org', 'github.com', 'stackoverflow.com', 'docs.python.org',
    'learn.microsoft.com', 'devdocs.io', 'react.dev', 'docs.rs', 'go.dev', 'developer.apple.com',
  ],
  discussions: [
    'reddit.com', 'stackexchange.com', 'stackoverflow.com', 'news.ycombinator.com',
    'lobste.rs', 'community.openai.com', 'discuss.python.org', 'forums.macrumors.com',
  ],
  academic: [
    'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'nature.com', 'journals.plos.org',
    'science.org', 'acm.org', 'ieee.org', 'jstor.org', 'biorxiv.org', 'openreview.net',
  ],
}

const siteOperator = /^(-?)site:([a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+)\.?$/i

function isDomainOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain)
}

function parseSiteOperators(query: string) {
  // Preserve quoted phrases and pass Boolean expressions through for the provider to interpret.
  const tokens = searchQueryTokens(query)
  if (tokens.some((token) => /^(?:AND|OR|NOT)$/.test(token))) {
    return { query, included: [], excluded: [] }
  }
  const included = new Set<string>()
  const excluded = new Set<string>()
  const terms = tokens.filter((token) => {
    const match = siteOperator.exec(token)
    if (!match) return true
    const domain = match[2]!.toLowerCase()
    if (domain.length > 253 || domain.split('.').some(label => label.length > 63)) return true
    const targets = match[1] ? excluded : included
    targets.add(domain)
    return false
  })
  return {
    query: included.size || excluded.size ? terms.join(' ') || query : query,
    included: [...included],
    excluded: [...excluded],
  }
}

export function searchHostFilters(query: string, scope: SearchScope | undefined) {
  const parsed = parseSiteOperators(query)
  const scoped = scope ? scopeHosts[scope] : []
  const included = scoped.length && parsed.included.length
    ? scoped.flatMap((domain) => parsed.included.flatMap((explicit) => {
      if (isDomainOrSubdomain(explicit, domain)) return [explicit]
      return isDomainOrSubdomain(domain, explicit) ? [domain] : []
    }))
    : [...scoped, ...parsed.included]
  const includeDomains = [...new Set(included)].filter((domain) =>
    !parsed.excluded.some((excluded) => isDomainOrSubdomain(domain, excluded)),
  )
  return {
    query: parsed.query,
    includeDomains,
    excludeDomains: parsed.excluded,
    matchesNothing: Boolean(scope || parsed.included.length) && !includeDomains.length,
    explicit: Boolean(parsed.included.length || parsed.excluded.length),
  }
}

export function filterSearchHosts(result: SearchResults, filters: ReturnType<typeof searchHostFilters>): SearchResults {
  const { includeDomains, excludeDomains } = filters
  if (!includeDomains.length && !excludeDomains.length) return result
  const matches = (value: string) => {
    const hostname = URL.parse(value)?.hostname.toLowerCase().replace(/\.$/, '')
    return Boolean(hostname
      && (!includeDomains.length || includeDomains.some(domain => isDomainOrSubdomain(hostname, domain)))
      && !excludeDomains.some(domain => isDomainOrSubdomain(hostname, domain)))
  }
  return {
    results: result.results.filter(row => matches(row.url)),
    ...(result.podcastShows ? { podcastShows: result.podcastShows.filter(row => matches(row.url)) } : {}),
    ...(result.hasMore === undefined ? {} : { hasMore: result.hasMore }),
    ...(result.answer?.url && matches(result.answer.url) ? { answer: result.answer } : {}),
    // Related queries do not carry typed operators. Keep the active scope without broadening typed filters.
    ...(result.related && !filters.explicit ? { related: result.related } : {}),
  }
}
