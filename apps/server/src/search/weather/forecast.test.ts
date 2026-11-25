import { describe, expect, it, vi } from 'vitest'
import { createWeatherClient, type WeatherCache } from './forecast.js'

const now = Date.parse('2026-11-24T04:30:00Z')
const atlanta = { name: 'Atlanta', country: 'United States', countryCode: 'US', timeZone: 'America/New_York', latitude: 33.74901, longitude: -84.38798 }
const paris = { name: 'Paris', country: 'France', countryCode: 'FR', timeZone: 'Europe/Paris', latitude: 48.856627, longitude: 2.352258 }
const alertUrl = 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.event.001.1'
const alert = {
  status: 'Actual', messageType: 'Alert', event: 'Wind Advisory', severity: 'Moderate', headline: 'Wind advisory for Atlanta',
  effective: '2026-11-24T04:00:00Z', onset: '2026-11-24T06:00:00Z',
  expires: '2026-11-24T05:00:00Z', ends: '2026-11-24T09:00:00Z',
}

function fixture() {
  const entries = new Map<string, string>()
  const cache: WeatherCache = {
    read: vi.fn(async (key: string) => entries.get(key) ?? null),
    write: vi.fn(async (key: string, value: string) => { entries.set(key, value) }),
    lease: vi.fn(async () => true),
  }
  const fetcher = vi.fn<typeof fetch>()
  let current = now
  return { cache, fetcher, client: createWeatherClient(cache, fetcher, () => current), setTime: (time: number) => { current = time } }
}

describe('Weather forecasts', () => {
  it('defaults to NOAA for US places and caches both the grid and the forecast', async () => {
    const { client, fetcher } = fixture()
    fetcher.mockResolvedValueOnce(Response.json({ properties: {
      gridId: 'FFC', gridX: 51, gridY: 87, forecastHourly: 'https://untrusted.example/',
    } }))
    fetcher.mockResolvedValueOnce(Response.json({ properties: {
      updateTime: '2026-11-24T03:00:00Z',
      periods: [
        { startTime: '2026-11-23T23:00:00-05:00', temperature: 50, temperatureUnit: 'F', shortForecast: 'Partly Cloudy',
          windSpeed: '10 mph', probabilityOfPrecipitation: { value: 10 } },
        { startTime: '2026-11-24T00:00:00-05:00', temperature: 41, temperatureUnit: 'F', shortForecast: 'Clear',
          probabilityOfPrecipitation: { value: 0 } },
        { startTime: '2026-11-24T13:00:00-05:00', temperature: 59, temperatureUnit: 'F', shortForecast: 'Sunny' },
      ],
    } }))
    const result = await client(atlanta, undefined)
    expect(result).toMatchObject({
      forecast: {
        updatedAt: '2026-11-24T03:00:00Z',
        validAt: '2026-11-23T23:00:00-05:00',
        temperatureC: 10,
        condition: 'Partly Cloudy',
        windKph: 16.1,
        precipitationChance: 10,
        hourly: [{ validAt: '2026-11-24T00:00:00-05:00', temperatureC: 5, condition: 'Clear', precipitationChance: 0 }],
        daily: [
          { date: '2026-11-23', highC: 10, lowC: 10 },
          { date: '2026-11-24', highC: 15, lowC: 5, condition: 'Sunny' },
        ],
      },
      sources: [{ name: 'National Weather Service' }, { name: 'GeoNames' }],
    })
    expect(await client(atlanta, undefined)).toEqual(result)
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.weather.gov/points/33.749,-84.3879',
      'https://api.weather.gov/gridpoints/FFC/51,87/forecast/hourly',
    ])
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ 'user-agent': expect.stringContaining('github.com/IsaacThoman/pulpo') })
  })

  it('requires explicit MET configuration, respects Expires and revalidates with Last-Modified', async () => {
    const { client, fetcher, setTime } = fixture()
    const modified = 'Tue, 24 Nov 2026 04:00:00 GMT'
    const expires = Date.parse('2026-11-24T09:00:00Z')
    fetcher.mockResolvedValueOnce(Response.json({ properties: {
      meta: { updated_at: '2026-11-24T04:00:00Z' },
      timeseries: [
        { time: '2026-11-24T04:00:00Z', data: {
          instant: { details: { air_temperature: 15, wind_speed: 3 } },
          next_1_hours: { summary: { symbol_code: 'lightrainshowers_day' }, details: { precipitation_amount: 1.1 } },
        } },
        { time: '2026-11-24T09:00:00Z', data: {
          instant: { details: { air_temperature: 18 } },
          next_6_hours: { summary: { symbol_code: 'fair_day' } },
        } },
        { time: '2026-11-24T05:00:00Z', data: {
          instant: { details: { air_temperature: 14 } },
          next_1_hours: { summary: { symbol_code: 'cloudy' } },
        } },
      ],
    } }, { headers: { 'last-modified': modified, expires: new Date(expires).toUTCString() } }))
    fetcher.mockResolvedValueOnce(new Response(null, { status: 304 }))
    expect(await client(paris, undefined)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()

    const first = await client(paris, 'weather@example.org')
    expect(first).toMatchObject({
      forecast: {
        temperatureC: 15, condition: 'Light rain showers', windKph: 10.8, precipitationMm: 1.1,
        hourly: [{ validAt: '2026-11-24T05:00:00Z', temperatureC: 14, condition: 'Cloudy' }],
      },
      sources: [{ name: 'MET Norway' }, { name: 'GeoNames' }],
    })
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=48.8566&lon=2.3522')
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ 'user-agent': 'PulpoSearch/1.0 (weather@example.org)' })

    setTime(expires - 1000)
    await client(paris, 'weather@example.org')
    expect(fetcher).toHaveBeenCalledTimes(1)
    setTime(expires + 1000)
    expect(await client(paris, 'weather@example.org')).toMatchObject({ forecast: { temperatureC: 18 } })
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ 'if-modified-since': modified })
  })

  it('pauses all lookups to a throttled host and never follows cross-origin redirects', async () => {
    const { client, fetcher } = fixture()
    fetcher.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '300' } }))
    expect(await client(paris, 'weather@example.org')).toBeNull()
    expect(await client({ ...paris, latitude: 52.52, longitude: 13.405 }, 'weather@example.org')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)

    fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/forecast' } }))
    expect(await client(atlanta, undefined)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('National Weather Service alerts', () => {
  it('caches public actual point alerts, shows event times and discards a stale message on failure', async () => {
    const { cache, client, fetcher, setTime } = fixture()
    fetcher.mockResolvedValueOnce(Response.json({
      type: 'FeatureCollection',
      features: [
        { id: alertUrl, properties: alert },
        { id: alertUrl + '.2', properties: { ...alert, status: 'Test' } },
        { id: alertUrl + '.3', properties: { ...alert, messageType: 'Cancel' } },
      ],
    }))
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }))

    const result = await client.alertsFor(atlanta)
    expect(result).toMatchObject({
      alerts: [{
        event: 'Wind Advisory', severity: 'Moderate', headline: 'Wind advisory for Atlanta',
        effectiveAt: '2026-11-24T06:00:00Z', expiresAt: '2026-11-24T09:00:00Z', url: alertUrl,
      }],
      source: { name: 'National Weather Service', url: 'https://forecast.weather.gov/MapClick.php?lat=33.749&lon=-84.3879' },
    })
    expect(await client.alertsFor(atlanta)).toEqual(result)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://api.weather.gov/alerts/active?point=33.749,-84.3879')
    expect(cache.lease).toHaveBeenCalledWith('search:weather:v1:nws-alerts:upstream', 30_000)
    setTime(now + 31_000)
    expect(await client.alertsFor(atlanta)).toBeNull()
    expect(await client.alertsFor(atlanta)).toBeNull()
    expect(await client.alertsFor(paris)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('keeps an authoritative empty response distinct from an expired bulletin or a denied lease', async () => {
    const { cache, client, fetcher, setTime } = fixture()
    fetcher.mockResolvedValueOnce(Response.json({ type: 'FeatureCollection', features: [] }))
    expect(await client.alertsFor(atlanta)).toMatchObject({ alerts: [] })

    setTime(now + 31_000)
    fetcher.mockResolvedValueOnce(Response.json({
      type: 'FeatureCollection', features: [{ id: alertUrl, properties: { ...alert, expires: '2026-11-24T04:30:00Z' } }],
    }))
    expect(await client.alertsFor(atlanta)).toBeNull()

    vi.mocked(cache.lease).mockImplementation(async key => !key.endsWith('nws-alerts:upstream'))
    const newPlace = { ...atlanta, latitude: 34 }
    expect(await client.alertsFor(newPlace)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
