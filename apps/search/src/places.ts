export interface PlaceQuery {
  query: string
  location?: string
  openNow?: boolean
}

export interface PlaceResult {
  name: string
  address: string
  website?: string
  phone?: string
  category?: string
  summary?: string
  priceLevel?: string
  googlePlaceId?: string
  coordinates?: [number, number]
  todayHours?: string[]
  weeklyHours?: { day: string; hours: string }[]
  openNow?: boolean
  rating?: { value: number; max: number; count?: number }
}

export type PlaceProvider = 'brave' | 'firecrawl'

export const placeProviderNames: Record<PlaceProvider, string> = {
  brave: 'Brave', firecrawl: 'Firecrawl Maps',
}

export interface PlaceResponse {
  provider: PlaceProvider
  results: PlaceResult[]
  correction?: string
  unverifiedHours?: number
}

interface PlaceIntent extends PlaceQuery {
  needsLocation?: { term: string; connector: string }
}

const localType = /(?<![\p{L}\p{N}])(?:restaurants?|coffee(?:\s+shops?)?|caf[eé]s?|baker(?:y|ies)|pizza|bookstores?|librar(?:y|ies)|pharmac(?:y|ies)|drugstores?|grocery\s+stores?|museums?|hotels?|parks?|hardware\s+stores?|movie\s+theat(?:er|re)s?|gas\s+stations?)(?![\p{L}\p{N}])/iu
const diningType = /(?<![\p{L}\p{N}])(?:ramen|sushi|pho|tacos?|burritos?|burgers?|dumplings?|dim\s+sum|falafel|barbecue|bbq|ice\s+cream|gelato|boba|bubble\s+tea|(?:chinese|indian|japanese|korean|mexican|thai|vietnamese|vegan|vegetarian)\s+food)$/iu
const informationalTerm = /\b(?:(?:history|origins?|ingredients|nutrition)\s+of|recipes?\s+for|how\s+to\s+(?:make|cook|prepare))\b|\b(?:recipes?|ingredients|nutrition|calories|history|origins?)$/i
const openNowPattern = /\s+(?:that (?:are|is) )?(?:open now|currently open)(?=\s|$)/i

export function placeIntent(query: string): PlaceIntent | undefined {
  const expression = query.trim().replace(/\?$/, '')
  if (expression.length > 500 || /["!]|\b(?:site|filetype):/i.test(expression)) return
  const text = expression.replace(openNowPattern, '')
  const parts = /^(.+?)\s+(near|around|in)\s+([\p{L}\p{N}].*)$/iu.exec(text)
  if (!parts) return
  const [, term, connector, area] = parts
  if (informationalTerm.test(term) || (!localType.test(term) && !diningType.test(term))) return
  const openNow = text !== expression
  if (/^(?:me|here)$/i.test(area)) return { query: text, openNow, needsLocation: { term, connector } }
  return { query: text, openNow, ...(connector.toLowerCase() === 'in' ? { location: area.slice(0, 150) } : {}) }
}
