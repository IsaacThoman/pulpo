import { describe, expect, it, vi } from 'vitest'
import { createWeatherClient, type WeatherCache } from './forecast.js'

const now = Date.parse('2026-11-24T04:30:00Z')
const atlanta = { name: 'Atlanta', country: 'United States', countryCode: 'US', timeZone: 'America/New_York', latitude: 33.74901, longitude: -84.38798 }
const paris = { name: 'Paris', country: 'France', countryCode: 'FR', timeZone: 'Europe/Paris', latitude: 48.856627, longitude: 2.352258 }

function fixture() {
  const entries = new Map<string, string>()
  const cache: WeatherCache = {
    read: vi.fn(async (key: string) => entries.get(key) ?? null),
    write: vi.fn(async (key: string, value: string) => { entries.set(key, value) }),
    lease: vi.fn(async () => true),
  }
  const fetcher = vi.fn<typeof fetch>()
  let current = now
  return { fetcher, client: createWeatherClient(cache, fetcher, () => current), setTime: (time: number) => { current = time } }
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
        { startTime: '2026-11-24T00:00:00-05:00', temperature: 41, temperatureUnit: 'F' },
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
        { time: '2026-11-24T09:00:00Z', data: { instant: { details: { air_temperature: 18 } } } },
      ],
    } }, { headers: { 'last-modified': modified, expires: new Date(expires).toUTCString() } }))
    fetcher.mockResolvedValueOnce(new Response(null, { status: 304 }))
    expect(await client(paris, undefined)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()

    const first = await client(paris, 'weather@example.org')
    expect(first).toMatchObject({
      forecast: { temperatureC: 15, condition: 'Light rain showers', windKph: 10.8, precipitationMm: 1.1 },
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
