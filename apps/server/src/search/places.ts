import { isSearchFaviconHost } from '@pulpo/contracts/search'
import { z } from 'zod'
import { FIRECRAWL_DEFAULT_API_BASE } from '../agent/firecrawl.js'
import { resultSnippet, resultUrl } from '../agent/search-results.js'

const placeSearchUrl = 'https://api.search.brave.com/res/v1/local/place_search'
const maximumResults = 15
const maximumResponseBytes = 2 * 1024 * 1024
const timeoutMs = 7500
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
type Weekday = (typeof weekdays)[number]

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
  summary?: string
  priceLevel?: string
  googlePlaceId?: string
  coordinates?: [latitude: number, longitude: number]
  timezone?: string
  todayHours?: string[]
  weeklyHours?: { day: string; hours: string }[]
  openNow?: boolean
  rating?: { value: number; max: number; count?: number }
}

export interface PlaceSearchResponse {
  provider: 'brave' | 'firecrawl'
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
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    })
    const parts = formatter.formatToParts(now)
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value
    const day = weekdays.findIndex(weekday => weekday === part('weekday'))
    if (day === -1) return
    return {
      timezone: formatter.resolvedOptions().timeZone,
      weekday: weekdays[day]!,
      yesterday: weekdays[(day + 6) % 7]!,
      date: `${part('year')}-${part('month')}-${part('day')}`,
      minute: Number(part('hour')) * 60 + Number(part('minute')),
    }
  } catch {
    return
  }
}

interface OpeningPeriod { opens: number; closes: number }
interface LabeledOpeningPeriod extends OpeningPeriod { label: string }

function braveDayPeriods(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 6) return
  const periods: LabeledOpeningPeriod[] = []
  let weekday: Weekday | undefined
  const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  for (const raw of value) {
    const period = record(raw)
    if (!period) return
    const { abbr_name: short, full_name: full, opens, closes } = period
    if (short == null && full == null) return
    const day = weekdays.find(name => (short == null || short === name.slice(0, 3)) && (full == null || full === name))
    if (!day || (weekday && day !== weekday) || typeof opens !== 'string' || !clockPattern.test(opens)
      || typeof closes !== 'string' || !(clockPattern.test(closes) || closes === '24:00') || opens === closes) return
    weekday = day
    periods.push({ opens: clockMinutes(opens), closes: clockMinutes(closes), label: `${opens}–${closes}` })
  }
  if (weekday) return { weekday, periods }
}

function isOpenDuring(today: OpeningPeriod[], yesterday: OpeningPeriod[] | undefined, minute: number) {
  return today.some(({ opens, closes }) => minute >= opens && (minute < closes || closes < opens))
    || yesterday?.some(({ opens, closes }) => closes < opens && minute < closes)
}

function bravePlaceHours(timezone: unknown, value: unknown, now: Date): Pick<PlaceResult, 'timezone' | 'todayHours' | 'weeklyHours' | 'openNow'> {
  const hours = record(value)
  const schedule = new Map<Weekday, LabeledOpeningPeriod[]>()
  const groups = Array.isArray(hours?.days) ? hours.days.slice(0, 7) : []
  for (const group of groups) {
    const day = braveDayPeriods(group)
    if (day && !schedule.has(day.weekday)) schedule.set(day.weekday, day.periods)
  }
  // Brave can omit this weekday from days, and its current_day may differ from the venue's local day.
  const current = braveDayPeriods(hours?.current_day)
  if (current) schedule.set(current.weekday, current.periods)

  const clock = localClock(timezone, now)
  if (!clock) {
    const weeklyHours = weekdays.flatMap(day => {
      const periods = schedule.get(day)
      return periods ? [{ day, hours: periods.map(period => period.label).join(', ') }] : []
    })
    return weeklyHours.length ? { weeklyHours } : {}
  }

  const today = schedule.get(clock.weekday)
  if (!today) return { timezone: clock.timezone }
  const yesterday = schedule.get(clock.yesterday)
  const open = isOpenDuring(today, yesterday, clock.minute)
  // Without yesterday's hours, an overnight period may still be active.
  return {
    timezone: clock.timezone,
    todayHours: today.map(period => period.label),
    ...(open ? { openNow: true } : yesterday ? { openNow: false } : {}),
  }
}

function placePhone(value: unknown) {
  const phone = placeText(value, 60)
  if (/^\+?[\d(][\d(). -]{5,30}(?:\s*(?:x|ext\.?)\s*\d{1,8})?$/i.test(phone)) return phone
}

function placeCategory(value: unknown) {
  if (Array.isArray(value)) return value.slice(0, 10).map(item => placeText(item, 100)).find(Boolean)
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
  const phone = placePhone(record(row.contact)?.telephone)
  const category = placeCategory(row.categories)
  const coordinates = placeCoordinates(row.coordinates)
  const rating = placeRating(row.rating)
  return {
    name, address,
    ...(website ? { website } : {}),
    ...(phone ? { phone } : {}),
    ...(category ? { category } : {}),
    ...(coordinates ? { coordinates } : {}),
    ...(rating ? { rating } : {}),
    ...bravePlaceHours(row.timezone, row.opening_hours, now),
  }
}

function firecrawlDayHours(rows: unknown[], date: string) {
  const matches = rows.filter(day => record(day)?.date === date)
  const hours = matches.length === 1 ? record(matches[0])?.hours : undefined
  if (!Array.isArray(hours) || !hours.length || hours.length > 6) return
  const labels = hours.map(hour => placeText(hour, 80))
  if (labels.some(label => !label)) return
  return labels
}

function firecrawlDayPeriods(labels: string[] | undefined): OpeningPeriod[] | undefined {
  if (!labels) return
  if (labels.length === 1 && /^closed$/i.test(labels[0]!)) return []
  if (labels.length === 1 && /^open 24 hours$/i.test(labels[0]!)) return [{ opens: 0, closes: 1440 }]
  const periods: OpeningPeriod[] = []
  const clockMinutes = (hour: string, minute: string | undefined, meridiem: string) =>
    (Number(hour) % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(minute ?? 0)
  for (const label of labels) {
    const match = /^(1[0-2]|[1-9])(?::([0-5]\d))?\s*(AM|PM)?\s*[-–—]\s*(1[0-2]|[1-9])(?::([0-5]\d))?\s*(AM|PM)$/i.exec(label)
    if (!match) return
    const [, startHour, startMinute, startMeridiem, endHour, endMinute, endMeridiem] = match
    const opens = clockMinutes(startHour!, startMinute, startMeridiem ?? endMeridiem!)
    const closes = clockMinutes(endHour!, endMinute, endMeridiem!)
    // A single meridiem only identifies the interval when both times fit in that half of the day.
    if (opens === closes || (!startMeridiem && opens > closes)) return
    periods.push({ opens, closes })
  }
  return periods
}

function firecrawlPlaceHours(row: Record<string, unknown>, now: Date): Pick<PlaceResult, 'timezone' | 'todayHours' | 'openNow'> {
  const clock = localClock(row.timezone, now)
  const timezone = clock ? { timezone: clock.timezone } : {}
  if (row.business_status === 'temporarily_closed' || row.business_status === 'permanently_closed') return { ...timezone, openNow: false }
  if (!clock || !Array.isArray(row.opening_hours)) return timezone

  const days = row.opening_hours.slice(0, 14)
  const previousDate = new Date(`${clock.date}T00:00:00Z`)
  previousDate.setUTCDate(previousDate.getUTCDate() - 1)
  const todayHours = firecrawlDayHours(days, clock.date)
  const today = firecrawlDayPeriods(todayHours)
  const yesterday = firecrawlDayPeriods(firecrawlDayHours(days, previousDate.toISOString().slice(0, 10)))
  const open = isOpenDuring(today ?? [], yesterday, clock.minute)
  const openNow = open ? true : today && (yesterday || !today.length) ? false : undefined
  const statusKnown = row.business_status == null || row.business_status === 'operational'
  return {
    ...timezone,
    ...(todayHours ? { todayHours } : {}),
    ...(statusKnown && openNow !== undefined ? { openNow } : {}),
  }
}

function normalizeFirecrawlPlace(value: unknown, now: Date): PlaceResult | undefined {
  const row = record(value)
  if (!row) return
  const name = placeText(row.name, 180)
  const address = placeText(row.address, 350)
  if (!name || !address) return

  const website = placeWebsite(row.website)
  const phone = placePhone(row.phone) ?? placePhone(row.phone_e164)
  const category = placeCategory(row.categories)
  const summary = placeText(row.editorial_summary, 180)
  const priceLevel = typeof row.price_level === 'string' && /^(?:\${1,4}|€{1,4}|£{1,4})$/.test(row.price_level.trim())
    ? row.price_level.trim() : undefined
  const googlePlaceId = typeof row.place_id === 'string' && /^[a-z\d_-]{10,200}$/i.test(row.place_id)
    ? row.place_id : undefined
  const coordinates = placeCoordinates([row.latitude, row.longitude])
  const rating = placeRating({ ratingValue: row.rating, bestRating: 5, reviewCount: row.review_count })
  return {
    name, address,
    ...(website ? { website } : {}),
    ...(phone ? { phone } : {}),
    ...(category ? { category } : {}),
    ...(summary ? { summary } : {}),
    ...(priceLevel ? { priceLevel } : {}),
    ...(googlePlaceId ? { googlePlaceId } : {}),
    ...(coordinates ? { coordinates } : {}),
    ...(rating ? { rating } : {}),
    ...firecrawlPlaceHours(row, now),
  }
}

function normalizePlaces(value: unknown, input: PlaceSearchInput, now: Date): PlaceSearchResponse {
  const payload = record(value)
  const rows = payload?.results
  if (payload?.type !== 'locations' || (rows != null && !Array.isArray(rows))) throw new Error('Unexpected place search response')
  const correction = placeText(record(payload.query)?.altered, 500)
  return {
    provider: 'brave',
    ...filterPlaces((rows ?? []).slice(0, maximumResults), input, now, normalizePlace),
    ...(correction && correction !== input.query ? { correction } : {}),
  }
}

function filterPlaces(rows: unknown[], input: PlaceSearchInput, now: Date, normalize: typeof normalizePlace) {
  const results: PlaceResult[] = []
  const seen = new Set<string>()
  let unverifiedHours = 0
  for (const row of rows) {
    const result = normalize(row, now)
    if (!result) continue
    const key = JSON.stringify([result.name.toLowerCase(), result.address.toLowerCase()])
    if (seen.has(key)) continue
    seen.add(key)
    if (input.openNow && result.openNow !== true) {
      if (result.openNow === undefined) unverifiedHours += 1
      continue
    }
    results.push(result)
    if (results.length >= maximumResults) break
  }
  const words = (value: string) => (value.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map(word => {
    if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
    return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
  }).join(' ')
  const subject = ` ${words(input.query.split(/\s+(?:near|around|in)\s+/i, 1)[0] ?? '')} `
  const ranked = results.map(place => {
    const category = words(place.category ?? '')
    return { place, score: category && subject.includes(` ${category} `) ? category.length : 0 }
  })
  ranked.sort((left, right) => right.score - left.score)
  return { results: ranked.map(({ place }) => place), ...(unverifiedHours ? { unverifiedHours } : {}) }
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

export async function searchFirecrawlPlaces(input: PlaceSearchInput, apiKey: string, signal?: AbortSignal): Promise<PlaceSearchResponse> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  requestSignal.throwIfAborted()
  const query = input.location && !input.query.toLowerCase().includes(input.location.toLowerCase())
    ? `${input.query} near ${input.location}` : input.query
  const capability = 'businesses/search'
  const response = await fetch(`${FIRECRAWL_DEFAULT_API_BASE}/scrape`, {
    method: 'POST', redirect: 'error', signal: requestSignal,
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'cache-control': 'no-cache' },
    body: JSON.stringify({ alexandria: { provider: 'firecrawl-maps', capability, options: { query } } }),
  })
  const payload = record(await readPlacesResponse(response))
  requestSignal.throwIfAborted()
  const alexandria = record(payload?.data)?.alexandria
  const result = Array.isArray(alexandria) && alexandria.length === 1 ? record(alexandria[0]) : undefined
  const rows = record(result?.data)?.results
  if (payload?.success !== true || result?.provider !== 'firecrawl-maps' || result.capability !== capability
    || result.error || result.requiresAction || !Array.isArray(rows)) throw new Error('Unexpected place search response')
  return { provider: 'firecrawl', ...filterPlaces(rows.slice(0, 50), input, new Date(), normalizeFirecrawlPlace) }
}
