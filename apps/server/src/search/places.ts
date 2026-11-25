import { isSearchFaviconHost } from '@pulpo/contracts/search'
import { z } from 'zod'
import { resultSnippet, resultUrl } from '../agent/search-results.js'

const placeSearchUrl = 'https://api.search.brave.com/res/v1/local/place_search'
const maximumResults = 15
const maximumResponseBytes = 2 * 1024 * 1024
const timeoutMs = 7500
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const placesCapability = { provider: 'brave', priceMicros: 5_000 } as const

export const placeSearchInput = z.object({
  query: z.string().trim().min(1).max(500),
  location: z.string().trim().min(1).max(150).optional(),
  openNow: z.boolean().optional(),
}).strict()
type PlaceSearchInput = z.infer<typeof placeSearchInput>

export interface PlaceResult {
  name: string
  address: string
  website?: string
  phone?: string
  category?: string
  coordinates?: [latitude: number, longitude: number]
  timezone?: string
  todayHours?: string[]
  openNow?: boolean
  rating?: { value: number; max: number; count?: number }
}

export interface PlaceSearchResponse {
  provider: 'brave'
  results: PlaceResult[]
  correction?: string
  unverifiedHours?: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
}

function placeText(value: unknown, limit: number): string {
  const text = resultSnippet(value, limit).replace(/\p{Cc}/gu, '').trim()
  return /<(?:\/?[a-z]|[!?])/i.test(text) ? '' : text
}

function placeWebsite(value: unknown): string | undefined {
  const normalized = resultUrl(value)
  if (!normalized) return
  const url = new URL(normalized)
  if (!url.port && isSearchFaviconHost(url.hostname)) return normalized
}

function placeCoordinates(value: unknown): PlaceResult['coordinates'] {
  if (!Array.isArray(value) || value.length !== 2) return
  const [lat, lon] = value
  if (typeof lat === 'number' && typeof lon === 'number' && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return [lat, lon]
}

function placeRating(value: unknown): PlaceResult['rating'] {
  const rating = record(value)
  const score = rating?.ratingValue
  const max = rating?.bestRating
  const count = rating?.reviewCount
  if (typeof score !== 'number' || typeof max !== 'number' || !Number.isFinite(max) || !(score >= 0 && score <= max && max > 0)) return
  return { value: score, max, ...(typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? { count } : {}) }
}

function localClock(timezone: unknown, now: Date) {
  if (typeof timezone !== 'string' || !/^[a-z][a-z\d_+\-/]{0,79}$/i.test(timezone)) return
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    const parts = formatter.formatToParts(now)
    const weekday = parts.find(part => part.type === 'weekday')?.value
    const day = weekdays.indexOf(weekday ?? '')
    if (day === -1) return
    return {
      timezone: formatter.resolvedOptions().timeZone,
      weekday,
      yesterday: weekdays[(day + 6) % 7],
      minute: Number(parts.find(part => part.type === 'hour')?.value) * 60 + Number(parts.find(part => part.type === 'minute')?.value),
    }
  } catch {
    return
  }
}

function dayPeriods(value: unknown, weekday: string | undefined) {
  if (!Array.isArray(value) || !value.length || value.length > 6) return
  const periods: Array<{ opens: number; closes: number; label: string }> = []
  const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  for (const raw of value) {
    const period = record(raw)
    const opens = period?.opens
    const closes = period?.closes
    if (period?.abbr_name !== weekday || typeof opens !== 'string' || !clockPattern.test(opens)
      || typeof closes !== 'string' || !(clockPattern.test(closes) || closes === '24:00') || opens === closes) return
    periods.push({ opens: clockMinutes(opens), closes: clockMinutes(closes), label: `${opens}–${closes}` })
  }
  return periods
}

function placeHours(timezone: unknown, value: unknown, now: Date): Pick<PlaceResult, 'timezone' | 'todayHours' | 'openNow'> {
  const clock = localClock(timezone, now)
  if (!clock) return {}
  const hours = record(value)
  const today = dayPeriods(hours?.current_day, clock.weekday)
  if (!today) return { timezone: clock.timezone }
  const previousDay = Array.isArray(hours?.days) ? hours.days.slice(0, 7).find(day =>
    Array.isArray(day) && record(day[0])?.abbr_name === clock.yesterday) : undefined
  const yesterday = dayPeriods(previousDay, clock.yesterday)
  const minute = clock.minute
  const open = today.some(period => minute >= period.opens && (minute < period.closes || period.closes < period.opens))
    || yesterday?.some(period => period.closes < period.opens && minute < period.closes)
  // Without yesterday's hours, an overnight period may still be active.
  return {
    timezone: clock.timezone,
    todayHours: today.map(period => period.label),
    ...(open ? { openNow: true } : yesterday ? { openNow: false } : {}),
  }
}

function normalizePlace(value: unknown, now: Date): PlaceResult | undefined {
  const row = record(value)
  if (!row || (row.type !== undefined && row.type !== 'location_result')) return
  const name = placeText(row.title, 180)
  const postal = record(row.postal_address)
  const address = placeText(postal?.displayAddress, 350) || ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'country']
    .map(field => placeText(postal?.[field], 60)).filter(Boolean).join(', ')
  if (!name || !address) return

  const website = placeWebsite(row.url)
  const phone = placeText(record(row.contact)?.telephone, 60)
  const category = Array.isArray(row.categories) ? row.categories.slice(0, 10).map(item => placeText(item, 100)).find(Boolean) : undefined
  const coordinates = placeCoordinates(row.coordinates)
  const rating = placeRating(row.rating)
  return {
    name, address,
    ...(website ? { website } : {}),
    ...(/^\+?[\d(][\d(). -]{5,30}(?:\s*(?:x|ext\.?)\s*\d{1,8})?$/i.test(phone) ? { phone } : {}),
    ...(category ? { category } : {}),
    ...(coordinates ? { coordinates } : {}),
    ...(rating ? { rating } : {}),
    ...placeHours(row.timezone, row.opening_hours, now),
  }
}

function normalizePlaces(value: unknown, input: PlaceSearchInput, now: Date): PlaceSearchResponse {
  const payload = record(value)
  const rows = payload?.results
  if (payload?.type !== 'locations' || (rows != null && !Array.isArray(rows))) throw new Error('Unexpected place search response')
  const correction = placeText(record(payload.query)?.altered, 500)
  const results: PlaceResult[] = []
  const seen = new Set<string>()
  let unverifiedHours = 0
  for (const row of (rows ?? []).slice(0, maximumResults)) {
    const result = normalizePlace(row, now)
    if (!result) continue
    const key = JSON.stringify([result.name.toLowerCase(), result.address.toLowerCase()])
    if (seen.has(key)) continue
    seen.add(key)
    if (input.openNow && result.openNow !== true) {
      if (result.openNow === undefined) unverifiedHours += 1
      continue
    }
    results.push(result)
  }
  return {
    provider: 'brave', results,
    ...(correction && correction !== input.query ? { correction } : {}),
    ...(unverifiedHours ? { unverifiedHours } : {}),
  }
}

async function readPlacesResponse(response: Response): Promise<unknown> {
  const body = response.body
  if (!response.ok || !body || Number(response.headers.get('content-length')) > maximumResponseBytes) {
    await body?.cancel().catch(() => {})
    throw new Error('Place search response unavailable')
  }
  const reader = body.getReader()
  const parts: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return JSON.parse(Buffer.concat(parts, bytes).toString('utf8'))
      bytes += value.byteLength
      if (bytes > maximumResponseBytes) throw new Error('Place search response exceeds the size limit')
      parts.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export async function searchPlaces(input: PlaceSearchInput, apiKey: string, signal?: AbortSignal): Promise<PlaceSearchResponse> {
  const url = new URL(placeSearchUrl)
  url.searchParams.set('q', input.query)
  if (input.location) url.searchParams.set('location', input.location)
  url.searchParams.set('count', String(maximumResults))
  url.searchParams.set('safesearch', 'strict')
  const timeout = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  requestSignal.throwIfAborted()
  const response = await fetch(url, {
    method: 'GET', redirect: 'error', signal: requestSignal,
    headers: { accept: 'application/json', 'x-subscription-token': apiKey, 'cache-control': 'no-cache' },
  })
  const result = normalizePlaces(await readPlacesResponse(response), input, new Date())
  requestSignal.throwIfAborted()
  return result
}
