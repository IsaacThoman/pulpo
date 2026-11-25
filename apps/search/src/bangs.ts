export interface CustomBang {
  trigger: string
  name: string
  url: string
}

const builtIns: readonly CustomBang[] = [
  { trigger: 'g', name: 'Google', url: 'https://www.google.com/search?q={query}' },
  { trigger: 'gi', name: 'Google Images', url: 'https://www.google.com/search?tbm=isch&q={query}' },
  { trigger: 'gm', name: 'Google Maps', url: 'https://www.google.com/maps/search/?api=1&query={query}' },
  { trigger: 'gn', name: 'Google News', url: 'https://news.google.com/search?q={query}' },
  { trigger: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' },
  { trigger: 'sp', name: 'Startpage', url: 'https://www.startpage.com/sp/search?query={query}' },
  { trigger: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q={query}' },
  { trigger: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q={query}' },
  { trigger: 'kagi', name: 'Kagi', url: 'https://kagi.com/search?q={query}' },
  { trigger: 'w', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search={query}' },
  { trigger: 'wd', name: 'Wiktionary', url: 'https://en.wiktionary.org/w/index.php?search={query}' },
  { trigger: 'wa', name: 'WolframAlpha', url: 'https://www.wolframalpha.com/input?i={query}' },
  { trigger: 'yt', name: 'YouTube', url: 'https://www.youtube.com/results?search_query={query}' },
  { trigger: 'r', name: 'Reddit', url: 'https://www.reddit.com/search/?q={query}' },
  { trigger: 'hn', name: 'Hacker News', url: 'https://hn.algolia.com/?q={query}' },
  { trigger: 'imdb', name: 'IMDb', url: 'https://www.imdb.com/find/?q={query}' },
  { trigger: 'letterboxd', name: 'Letterboxd', url: 'https://letterboxd.com/search/{query}/' },
  { trigger: 'goodreads', name: 'Goodreads', url: 'https://www.goodreads.com/search?q={query}' },
  { trigger: 'ol', name: 'Open Library', url: 'https://openlibrary.org/search?q={query}' },
  { trigger: 'archive', name: 'Internet Archive', url: 'https://archive.org/search?query={query}' },
  { trigger: 'gh', name: 'GitHub', url: 'https://github.com/search?q={query}' },
  { trigger: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q={query}' },
  { trigger: 'mdn', name: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/search?q={query}' },
  { trigger: 'npm', name: 'npm', url: 'https://www.npmjs.com/search?q={query}' },
  { trigger: 'pypi', name: 'PyPI', url: 'https://pypi.org/search/?q={query}' },
  { trigger: 'crates', name: 'crates.io', url: 'https://crates.io/search?q={query}' },
  { trigger: 'arxiv', name: 'arXiv', url: 'https://arxiv.org/search/?query={query}&searchtype=all' },
  { trigger: 'scholar', name: 'Google Scholar', url: 'https://scholar.google.com/scholar?q={query}' },
  { trigger: 'pubmed', name: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/?term={query}' },
  { trigger: 'osm', name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/search?query={query}' },
  { trigger: 'a', name: 'Amazon', url: 'https://www.amazon.com/s?k={query}' },
  { trigger: 'ebay', name: 'eBay', url: 'https://www.ebay.com/sch/i.html?_nkw={query}' },
  { trigger: 'etsy', name: 'Etsy', url: 'https://www.etsy.com/search?q={query}' },
  { trigger: 'steam', name: 'Steam', url: 'https://store.steampowered.com/search/?term={query}' },
  { trigger: 'spot', name: 'Spotify', url: 'https://open.spotify.com/search/{query}' },
  { trigger: 'translate', name: 'Google Translate', url: 'https://translate.google.com/?sl=auto&tl=en&text={query}' },
]

const triggerPattern = /^[a-z0-9][a-z0-9_-]{0,23}$/
const placeholder = '{query}'
const pathMarker = 'pulpo-search-bang-query-placeholder'

function normalizeTrigger(trigger: string): string {
  return trigger.trim().replace(/^!/, '').toLowerCase()
}

export function validateCustomBang(bang: CustomBang): string | null {
  if (!triggerPattern.test(normalizeTrigger(bang.trigger))) return 'Use 1–24 letters, digits, hyphens, or underscores for the shortcut.'
  if (!bang.name.trim() || bang.name.length > 80) return 'Enter a name up to 80 characters.'
  const url = bang.url.trim()
  if (!url.includes(placeholder) || url.includes(pathMarker) || url.length > 2_048) {
    return 'Enter a destination URL with {query} in its path or query string.'
  }
  try {
    const parsed = new URL(url.replaceAll(placeholder, pathMarker))
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.host.includes(pathMarker)
      && !parsed.hash.includes(pathMarker) && (parsed.pathname.includes(pathMarker) || parsed.search.includes(pathMarker))) {
      return null
    }
  } catch {
    // Report an invalid template using the same guidance.
  }
  return 'Use an HTTPS destination with {query} only in its path or query string.'
}

function allBangs(customBangs: readonly CustomBang[]): Map<string, CustomBang> {
  const bangs = new Map(builtIns.map(bang => [bang.trigger, bang]))
  for (const custom of customBangs) {
    if (validateCustomBang(custom)) continue
    const trigger = normalizeTrigger(custom.trigger)
    bangs.set(trigger, { trigger, name: custom.name.trim(), url: custom.url.trim() })
  }
  return bangs
}

export function resolveBang(query: string, customBangs: readonly CustomBang[] = []): CustomBang | null {
  const words = query.trim().split(/\s+/)
  const bangs = allBangs(customBangs)
  for (const [index, word] of words.entries()) {
    if (!word.startsWith('!')) continue
    const bang = bangs.get(normalizeTrigger(word))
    if (!bang) continue
    const terms = [...words.slice(0, index), ...words.slice(index + 1)].join(' ').replace(/[\uD800-\uDFFF]/gu, '\uFFFD')
    const encoded = encodeURIComponent(terms)
    return { ...bang, url: bang.url.replaceAll(placeholder, encoded) }
  }
  return null
}

export function searchBangs(query: string, customBangs: readonly CustomBang[] = []): CustomBang[] {
  const value = normalizeTrigger(query)
  const bangs = [...allBangs(customBangs).values()]
  if (!value) return bangs
  const matches = bangs.filter(bang => bang.trigger.includes(value) || bang.name.toLowerCase().includes(value))
  return matches.sort((a, b) => rank(a.trigger, value) - rank(b.trigger, value))
}

function rank(trigger: string, value: string): number {
  if (trigger === value) return 0
  return trigger.startsWith(value) ? 1 : 2
}
