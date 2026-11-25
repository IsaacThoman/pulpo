import { createHash } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { z } from 'zod'
import type { WeatherPlace } from './geocoder.js'

const minute = 60_000
const hour = 60 * minute
const nwsOrigin = 'https://api.weather.gov'
const metOrigin = 'https://api.met.no'
const maximumBody = 512 * 1024
const defaultContact = 'https://github.com/IsaacThoman/pulpo'
const nwsCountries = new Set(['US', 'PR', 'VI', 'GU', 'AS', 'MP'])

export function supportsNws(countryCode: string) {
  return nwsCountries.has(countryCode)
}

export const geonamesSource = { name: 'GeoNames', url: 'https://www.geonames.org/export/', license: 'https://creativecommons.org/licenses/by/4.0/' }
const nwsSource = { name: 'National Weather Service', url: 'https://www.weather.gov/documentation/services-web-api', license: 'https://www.weather.gov/disclaimer' }
const metSource = {
  name: 'MET Norway',
  url: 'https://api.met.no/weatherapi/locationforecast/2.0/documentation',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  note: 'Forecast periods summarized and formatted by Pulpo.',
}

interface ForecastPoint {
  validAt: string
  temperatureC: number
  condition?: string
  windKph?: number
  precipitationMm?: number
  precipitationChance?: number
  hourly?: boolean
}
interface Timeline {
  updatedAt: string
  points: ForecastPoint[]
}
interface CacheEntry<T> {
  freshUntil: number
  value: T | null
  checkedAt?: number
  modified?: string
  etag?: string
}

export interface WeatherCache {
  read(key: string): Promise<string | null>
  write(key: string, value: string, ttlSeconds: number): Promise<unknown>
  lease(key: string, ttlMs: number): Promise<boolean>
}

const isoTime = z.iso.datetime({ offset: true })
const temperature = z.number().min(-150).max(200)
const nwsGrid = z.object({ properties: z.object({
  gridId: z.string().regex(/^[A-Z]{3}$/),
  gridX: z.number().int().min(0).max(9999),
  gridY: z.number().int().min(0).max(9999),
}) })
const nwsHourly = z.object({ properties: z.object({
  updateTime: isoTime,
  periods: z.array(z.object({
    startTime: isoTime,
    temperature,
    temperatureUnit: z.enum(['F', 'C']),
    shortForecast: z.string().max(100).optional(),
    windSpeed: z.string().max(30).optional(),
    probabilityOfPrecipitation: z.object({ value: z.number().min(0).max(100).nullable() }).optional(),
  })).min(1).max(200),
}) })
const alertSeverities = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'] as const
const nwsAlerts = z.object({
  type: z.literal('FeatureCollection'),
  pagination: z.object({ next: z.string() }).nullish(),
  features: z.array(z.object({
    id: z.string().regex(/^https:\/\/api\.weather\.gov\/alerts\/[A-Za-z0-9._:%-]+$/).max(300),
    properties: z.object({
      status: z.enum(['Actual', 'Exercise', 'System', 'Test', 'Draft']),
      messageType: z.enum(['Alert', 'Update', 'Cancel', 'Ack', 'Error']),
      severity: z.enum(alertSeverities),
      event: z.string().trim().min(1).max(120),
      headline: z.string().max(500).nullish(),
      effective: isoTime,
      onset: isoTime.nullish(),
      expires: isoTime,
      ends: isoTime.nullish(),
    }),
  })).max(128),
})
const metForecast = z.object({ properties: z.object({
  meta: z.object({ updated_at: isoTime }),
  timeseries: z.array(z.object({
    time: isoTime,
    data: z.object({
      instant: z.object({ details: z.object({
        air_temperature: temperature,
        wind_speed: z.number().min(0).max(150).optional(),
      }) }),
      next_1_hours: z.object({
        summary: z.object({ symbol_code: z.string().regex(/^[a-z_]+$/).max(60) }).optional(),
        details: z.object({ precipitation_amount: z.number().min(0).max(200).optional() }).optional(),
      }).optional(),
      next_6_hours: z.object({ summary: z.object({ symbol_code: z.string().regex(/^[a-z_]+$/).max(60) }).optional() }).optional(),
    }),
  })).min(1).max(240),
}) })

function decimal(value: number) {
  return String(Number((Math.trunc(value * 10_000) / 10_000).toFixed(4)))
}
function rounded(value: number) {
  return Math.round(value * 10) / 10
}
function metCondition(symbol: string | undefined) {
  const condition = symbol?.replace(/_(?:day|night|polartwilight)$/, '')
    .replace(/(light|heavy)(?=rain|sleet|snow)/g, '$1 ')
    .replace(/partlycloudy/g, 'partly cloudy').replace(/clearsky/g, 'clear sky')
    .replace(/showers/g, ' showers').replace(/andthunder/g, ' and thunder')
  return condition ? condition[0]!.toUpperCase() + condition.slice(1) : undefined
}
function dateHeader(value: string | null) {
  const time = Date.parse(value ?? '')
  return Number.isFinite(time) ? time : 0
}
function cacheFreshUntil(response: Response, now: number, minimum: number) {
  const age = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '')
  return Math.max(now + minimum, dateHeader(response.headers.get('expires')), age ? now + Number(age[1]) * 1000 : 0)
}

function retryAfter(response: Response, now: number) {
  const retry = response.headers.get('retry-after')
  return retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : dateHeader(retry)
}

async function readForecastJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > maximumBody) {
    await response.body?.cancel()
    throw new Error('Weather response is missing a bounded JSON body')
  }
  const reader = response.body.getReader()
  const blocks: Uint8Array[] = []
  let length = 0
  while (true) {
    const block = await reader.read()
    if (block.done) break
    length += block.value.length
    if (length > maximumBody) {
      await reader.cancel()
      throw new Error('Weather response exceeds the size limit')
    }
    blocks.push(block.value)
  }
  return JSON.parse(Buffer.concat(blocks, length).toString('utf8'))
}

function readCacheEntry<T>(value: string | null): CacheEntry<T> | undefined {
  if (!value) return undefined
  try { return JSON.parse(value) as CacheEntry<T> } catch { return undefined }
}

function dateAt(formatter: Intl.DateTimeFormat, value: string | number) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]))
  return [parts.year, parts.month, parts.day].join('-')
}

function renderForecast(timeline: Timeline, place: WeatherPlace, now: number, nws: boolean) {
  const points = [...timeline.points].sort((a, b) => Date.parse(a.validAt) - Date.parse(b.validAt))
  const current = points.findLast(point => Date.parse(point.validAt) <= now) ?? points[0]
  if (!current || Date.parse(current.validAt) < now - 6 * hour) return null
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: place.timeZone,
  })
  const today = dateAt(formatter, now)
  const days = new Map<string, ForecastPoint[]>()
  for (const point of points) {
    const date = dateAt(formatter, point.validAt)
    if (date < today) continue
    const group = days.get(date) ?? []
    group.push(point)
    days.set(date, group)
  }
  const daily = [...days].filter(([date, readings]) => {
    if (date === today) return true
    return Date.parse(readings.at(-1)!.validAt) - Date.parse(readings[0]!.validAt) >= 12 * hour
  }).slice(0, 7).map(([date, readings]) => {
    const temperatures = readings.map(point => point.temperatureC)
    const condition = readings[Math.floor(readings.length / 2)]?.condition
    return { date, lowC: Math.min(...temperatures), highC: Math.max(...temperatures), ...(condition ? { condition } : {}) }
  })
  const hourly = points.filter(point => {
    const start = Date.parse(point.validAt)
    return start > now && start <= now + 12 * hour && (nws || point.hourly)
  }).slice(0, 12).map(({ validAt, temperatureC, condition, precipitationChance }) => ({
    validAt, temperatureC, condition, precipitationChance,
  }))
  const { hourly: _hourly, ...conditions } = current
  return { updatedAt: timeline.updatedAt, ...conditions, hourly, daily }
}

export function createWeatherClient(cache: WeatherCache, fetcher = fetch, now = Date.now) {
  const inFlight = new Map<string, Promise<unknown>>()

  async function requestForecast(url: URL, headers: HeadersInit, maxAttempts: number, timeoutMs: number) {
    const signal = AbortSignal.timeout(timeoutMs)
    let target = url
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await fetcher(target, { headers, signal, redirect: 'manual' })
      if (![301, 302, 303, 307, 308].includes(response.status)) return response
      await response.body?.cancel()
      const next = new URL(response.headers.get('location') ?? '', target)
      if (next.origin !== url.origin || next.username || next.password || next.href === target.href) {
        throw new Error('Weather provider redirected outside its verified origin')
      }
      target = next
    }
    throw new Error('Weather provider redirected repeatedly')
  }

  function cached<T>(url: URL, minimum: number, identification: string, parse: (data: unknown) => T, alertFeed = false): Promise<T | null> {
    const key = 'search:weather:v1:' + createHash('sha256').update(url.href).digest('hex')
    const nwsForecast = url.origin === nwsOrigin && !alertFeed
    const timeoutMs = nwsForecast && url.pathname.endsWith('/forecast/hourly') ? 12_000 : 3500
    const existing = inFlight.get(key)
    if (existing) return existing as Promise<T | null>
    const result = (async () => {
      const entry = readCacheEntry<T>(await cache.read(key))
      const at = now()
      // Older NWS negative entries used the successful forecast's refresh interval.
      const oldNegative = nwsForecast && entry?.value === null && entry.checkedAt === undefined
      if (entry && entry.freshUntil > at && !oldNegative) return entry.value
      const fallback = alertFeed ? null : entry?.value ?? null
      const pauseKey = 'search:weather:v1:pause:' + url.hostname
      if (Number(await cache.read(pauseKey)) > at) return fallback
      if (!await cache.lease(key + ':refresh', Math.max(10_000, timeoutMs + 2000))) return fallback
      // NWS recommends at most one alert fetch every 30 seconds, shared across instances.
      if (alertFeed && !await cache.lease('search:weather:v1:nws-alerts:upstream', 30_000)) return null
      // The shared lease caps starts below MET's limit across this instance, including redirects.
      let slot = await cache.lease('search:weather:v1:upstream', 125)
      for (let attempt = 0; !slot && attempt < 2; attempt++) {
        await setTimeout(125)
        slot = await cache.lease('search:weather:v1:upstream', 125)
      }
      if (!slot) return fallback

      let next: CacheEntry<T> = { ...(alertFeed ? {} : entry), value: fallback, freshUntil: at + minimum }
      try {
        const response = await requestForecast(url, {
          'user-agent': 'PulpoSearch/1.0 (' + identification + ')',
          accept: 'application/geo+json, application/json',
          ...(entry?.modified ? { 'if-modified-since': entry.modified } : {}),
          ...(entry?.etag ? { 'if-none-match': entry.etag } : {}),
        }, alertFeed ? 1 : 2, timeoutMs)
        const atResponse = now()
        const transient = nwsForecast && response.status >= 500
        next.freshUntil = transient
          ? Math.max(atResponse + minute, retryAfter(response, atResponse))
          : cacheFreshUntil(response, atResponse, minimum)
        if (response.status === 429) {
          const retryUntil = retryAfter(response, atResponse)
          next.freshUntil = Math.max(next.freshUntil, retryUntil)
          const pauseUntil = Math.max(retryUntil, now() + minute)
          await cache.write(pauseKey, String(pauseUntil), Math.ceil((pauseUntil - now()) / 1000))
        }
        if (response.ok) {
          const value = parse(await readForecastJson(response))
          const modified = response.headers.get('last-modified')
          const etag = response.headers.get('etag')
          next = {
            freshUntil: next.freshUntil,
            value,
            ...(modified && dateHeader(modified) && dateHeader(modified) <= now() ? { modified } : {}),
            ...(etag && etag.length < 256 ? { etag } : {}),
          }
        } else {
          if (response.status === 304 && entry?.value != null) next = { ...entry, freshUntil: next.freshUntil }
          await response.body?.cancel()
        }
      } catch {
        // Retain the last usable forecast and retry transient NWS failures promptly.
        if (nwsForecast) next.freshUntil = now() + minute
      }
      if (nwsForecast && next.value === null) next.checkedAt = now()
      const ttl = Math.ceil((next.freshUntil - now()) / 1000)
      await cache.write(key, JSON.stringify(next), alertFeed ? Math.max(120, ttl + 60) : Math.max(7 * 24 * 3600, ttl + 3600))
      return next.value
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, result)
    return result
  }

  async function nws(lat: string, lon: string): Promise<Timeline | null> {
    const grid = await cached(new URL('/points/' + lat + ',' + lon, nwsOrigin), 24 * hour, defaultContact,
      data => nwsGrid.parse(data).properties)
    if (!grid) return null
    const forecast = new URL('/gridpoints/' + grid.gridId + '/' + grid.gridX + ',' + grid.gridY + '/forecast/hourly', nwsOrigin)
    return cached(forecast, 15 * minute, defaultContact, data => {
      const { updateTime, periods } = nwsHourly.parse(data).properties
      return { updatedAt: updateTime, points: periods.map(period => {
        const wind = /^(\d+) mph$/.exec(period.windSpeed ?? '')
        return {
          validAt: period.startTime,
          temperatureC: period.temperatureUnit === 'F' ? rounded((period.temperature - 32) * 5 / 9) : period.temperature,
          ...(period.shortForecast ? { condition: period.shortForecast } : {}),
          ...(wind ? { windKph: rounded(Number(wind[1]) * 1.609344) } : {}),
          ...(period.probabilityOfPrecipitation?.value != null ? { precipitationChance: period.probabilityOfPrecipitation.value } : {}),
        }
      }) }
    })
  }

  function met(lat: string, lon: string, contact: string): Promise<Timeline | null> {
    const url = new URL('/weatherapi/locationforecast/2.0/compact', metOrigin)
    url.search = new URLSearchParams({ lat, lon }).toString()
    // Three hours complies with the worldwide minimum, including Nordic points.
    return cached(url, 3 * hour, contact, data => {
      const { meta, timeseries } = metForecast.parse(data).properties
      return { updatedAt: meta.updated_at, points: timeseries.map(({ time, data: point }) => {
        const { air_temperature, wind_speed } = point.instant.details
        const condition = metCondition(point.next_1_hours?.summary?.symbol_code ?? point.next_6_hours?.summary?.symbol_code)
        const precipitation = point.next_1_hours?.details?.precipitation_amount
        return {
          validAt: time, temperatureC: air_temperature,
          hourly: Boolean(point.next_1_hours),
          ...(condition ? { condition } : {}),
          ...(wind_speed === undefined ? {} : { windKph: rounded(wind_speed * 3.6) }),
          ...(precipitation === undefined ? {} : { precipitationMm: precipitation }),
        }
      }) }
    })
  }

  async function forecastFor(place: WeatherPlace & { countryCode: string; latitude: number; longitude: number }, metContact: string | undefined) {
    const lat = decimal(place.latitude)
    const lon = decimal(place.longitude)
    if (supportsNws(place.countryCode)) {
      const timeline = await nws(lat, lon)
      const forecast = timeline && renderForecast(timeline, place, now(), true)
      if (forecast) return { forecast, sources: [nwsSource, geonamesSource] }
    }
    if (!metContact) return null
    const timeline = await met(lat, lon, metContact)
    const forecast = timeline && renderForecast(timeline, place, now(), false)
    return forecast ? { forecast, sources: [metSource, geonamesSource] } : null
  }

  async function alertsFor(place: { countryCode: string; latitude: number; longitude: number }) {
    if (!supportsNws(place.countryCode)) return null
    const lat = decimal(place.latitude)
    const lon = decimal(place.longitude)
    const point = new URL('/alerts/active', nwsOrigin)
    point.search = '?point=' + lat + ',' + lon
    const active = await cached(point, 30_000, defaultContact, data => {
      const feed = nwsAlerts.parse(data)
      if (feed.pagination?.next) throw new Error('Weather alert feed is incomplete')
      return feed.features.filter(({ properties }) => properties.status === 'Actual'
        && (properties.messageType === 'Alert' || properties.messageType === 'Update'))
    }, true)
    if (!active) return null

    const at = now()
    const ongoing = active.filter(({ properties }) => Date.parse(properties.ends ?? properties.expires) > at)
    const verified = ongoing.filter(({ properties }) => Date.parse(properties.expires) > at)
    if (!verified.length && ongoing.length) return null
    const alerts = verified.sort((a, b) => alertSeverities.indexOf(a.properties.severity) - alertSeverities.indexOf(b.properties.severity))
      .slice(0, 8)
      .map(({ id, properties }) => ({
        event: properties.event,
        ...(properties.headline ? { headline: properties.headline } : {}),
        severity: properties.severity,
        effectiveAt: properties.onset ?? properties.effective,
        expiresAt: properties.ends ?? properties.expires,
        url: id,
      }))
    const source = new URL('https://forecast.weather.gov/MapClick.php')
    source.search = new URLSearchParams({ lat, lon }).toString()
    return { alerts, source: { ...nwsSource, url: source.href } }
  }

  return Object.assign(forecastFor, { alertsFor })
}
