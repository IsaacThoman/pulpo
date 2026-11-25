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
  coordinates?: [number, number]
  todayHours?: string[]
  openNow?: boolean
  rating?: { value: number; max: number; count?: number }
}

export interface PlaceResponse {
  provider: 'brave'
  results: PlaceResult[]
  correction?: string
  unverifiedHours?: number
}

interface PlaceIntent extends PlaceQuery {
  needsLocation?: { term: string; connector: string }
}

const localType = /(?<![\p{L}\p{N}])(?:restaurants?|coffee(?:\s+shops?)?|caf[eé]s?|baker(?:y|ies)|pizza|bookstores?|pharmac(?:y|ies)|drugstores?|grocery\s+stores?|museums?|hotels?|parks?|hardware\s+stores?|movie\s+theat(?:er|re)s?|gas\s+stations?)(?![\p{L}\p{N}])/iu
const openNowPattern = /\s+(?:that (?:are|is) )?(?:open now|currently open)(?=\s|$)/i

export function placeIntent(query: string): PlaceIntent | undefined {
  const expression = query.trim().replace(/\?$/, '')
  if (expression.length > 500 || /["!]|\b(?:site|filetype):/i.test(expression)) return
  const text = expression.replace(openNowPattern, '')
  const parts = /^(.+?)\s+(near|around|in)\s+([\p{L}\p{N}].*)$/iu.exec(text)
  if (!parts || !localType.test(parts[1])) return
  const [, term, connector, area] = parts
  const openNow = text !== expression
  if (/^(?:me|here)$/i.test(area)) return { query: text, openNow, needsLocation: { term, connector } }
  return { query: text, openNow, ...(connector.toLowerCase() === 'in' ? { location: area.slice(0, 150) } : {}) }
}
