import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { placeSearchInput, searchPlaces } from './places.js'

const tuesday = { abbr_name: 'Tue', full_name: 'Tuesday', opens: '07:00', closes: '18:00' }
const monday = { ...tuesday, abbr_name: 'Mon', full_name: 'Monday' }
const cafe = {
  type: 'location_result',
  id: 'short-lived-id',
  title: '<b>Harbor Coffee</b>',
  url: 'https://harbor-coffee.example.com',
  provider_url: 'https://directory.example.com/private',
  postal_address: { displayAddress: '42 Harbor St, San Francisco, CA' },
  coordinates: [37.7825, -122.4095],
  contact: { telephone: '+1 (415) 555-0198', email: 'office@example.com' },
  categories: ['Coffee &amp; Tea'],
  rating: { ratingValue: 4.5, bestRating: 5, reviewCount: 1250 },
  opening_hours: { current_day: [tuesday], days: [[monday], [tuesday]] },
  timezone: 'America/Los_Angeles',
}

function mockResponse(body: object) {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(body))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

beforeEach(() => vi.setSystemTime(new Date('2026-11-24T18:00:00Z')))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Brave place search', () => {
  it('sends only the typed query and anchor to the fixed endpoint and returns display fields', async () => {
    const fetch = mockResponse({ type: 'locations', results: [cafe], query: { altered: 'coffee shops' } })
    const input = placeSearchInput.parse({ query: ' coffe shops ', location: ' San Francisco CA ', openNow: true })
    await expect(searchPlaces(input, 'test-key')).resolves.toEqual({
      provider: 'brave', correction: 'coffee shops', results: [{
        name: 'Harbor Coffee', address: '42 Harbor St, San Francisco, CA', website: 'https://harbor-coffee.example.com/',
        coordinates: [37.7825, -122.4095], phone: '+1 (415) 555-0198', category: 'Coffee & Tea',
        rating: { value: 4.5, max: 5, count: 1250 },
        timezone: 'America/Los_Angeles', todayHours: ['07:00–18:00'], openNow: true,
      }],
    })
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      new URL('https://api.search.brave.com/res/v1/local/place_search?q=coffe+shops&location=San+Francisco+CA&count=15&safesearch=strict'),
      { method: 'GET', redirect: 'error', signal: expect.any(AbortSignal),
        headers: { 'x-subscription-token': 'test-key', accept: 'application/json', 'cache-control': 'no-cache' } },
    )
  })

  it('keeps valid results when other rows or optional fields are invalid and deduplicates locations', async () => {
    const fetch = mockResponse({ type: 'locations', results: [
      null, { type: 'street', title: 'Not a POI' }, { title: 'Missing address' },
      { ...cafe, title: '&lt;img&gt;' },
      { ...cafe, url: 'https://127.0.0.1/out', coordinates: [200, -122], contact: { telephone: 'javascript:alert(1)' },
        categories: [null, 'Coffee'], rating: { ratingValue: 10, bestRating: 5 }, timezone: 'Invalid/Timezone' },
      cafe,
      { ...cafe, title: 'Second Cafe', url: 'https://user@second.example.com', opening_hours: null,
        postal_address: { streetAddress: '10 Main St', addressLocality: 'Oakland' },
        rating: { ratingValue: 4.2, bestRating: 5, reviewCount: -1 } },
    ] })
    await expect(searchPlaces({ query: 'cafes in Oakland & San Francisco' }, 'test-key')).resolves.toEqual({
      provider: 'brave', results: [
        { name: 'Harbor Coffee', address: '42 Harbor St, San Francisco, CA', category: 'Coffee' },
        { name: 'Second Cafe', address: '10 Main St, Oakland', timezone: 'America/Los_Angeles',
          coordinates: [37.7825, -122.4095], phone: '+1 (415) 555-0198', category: 'Coffee & Tea', rating: { value: 4.2, max: 5 } },
      ],
    })
    expect(fetch.mock.calls[0]?.[0].searchParams.has('location')).toBe(false)
  })

  it('uses the place clock and handles intervals across midnight', async () => {
    vi.setSystemTime(new Date('2026-11-24T09:00:00Z')) // 1 a.m. Tuesday in San Francisco.
    const lateMonday = { ...monday, opens: '20:00', closes: '02:00' }
    mockResponse({ type: 'locations', results: [
      { ...cafe, title: 'Overnight cafe', opening_hours: { current_day: [tuesday], days: [[lateMonday]] } },
      { ...cafe, title: 'Closed cafe' },
      { ...cafe, title: 'Unknown cafe', opening_hours: { current_day: [tuesday] } },
      { ...cafe, title: 'Missing timezone', timezone: undefined },
      { ...cafe, title: 'Wrong weekday', opening_hours: { current_day: [monday] } },
      { ...cafe, title: 'Unsupported hours', opening_hours: { current_day: [{ ...tuesday, opens: '24 hours' }] } },
    ] })
    const result = await searchPlaces({ query: 'cafes', openNow: true }, 'test-key')
    expect(result.results.map(place => [place.name, place.openNow])).toEqual([['Overnight cafe', true]])
    expect(result.unverifiedHours).toBe(4)
  })

  it('distinguishes verified closed, unknown and split published opening hours', async () => {
    mockResponse({ type: 'locations', results: [
      { ...cafe, title: 'Closed now', opening_hours: { days: [[monday]], current_day: [
        { ...tuesday, closes: '09:00' }, { ...tuesday, opens: '11:00' },
      ] } },
      { ...cafe, title: 'Unknown', opening_hours: null },
      { ...cafe, title: 'Open all day', opening_hours: { current_day: [{ ...tuesday, opens: '00:00', closes: '24:00' }] } },
    ] })
    const { results } = await searchPlaces({ query: 'cafes' }, 'test-key')
    expect(results.map(({ openNow, todayHours }) => [openNow, todayHours])).toEqual([
      [false, ['07:00–09:00', '11:00–18:00']], [undefined, undefined], [true, ['00:00–24:00']],
    ])
  })

  it.each([{ type: 'locations' }, { type: 'locations', results: null }])('accepts an empty point of interest group', async (body) => {
    mockResponse(body)
    await expect(searchPlaces({ query: 'no matches' }, 'test-key')).resolves.toEqual({ provider: 'brave', results: [] })
  })

  it.each([{}, { type: 'locations', results: { title: 'Not a list' } }])('rejects invalid provider payloads', async (body) => {
    mockResponse(body)
    await expect(searchPlaces({ query: 'cafes' }, 'test-key')).rejects.toThrow('Unexpected place search response')
  })

  it('rejects failed and oversized provider responses without exposing their contents', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('unexpected provider diagnostics and token', { status: 429 }))
      .mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1))))
    await expect(searchPlaces({ query: 'cafes' }, 'test-key')).rejects.toThrow('Place search response unavailable')
    await expect(searchPlaces({ query: 'cafes' }, 'test-key')).rejects.toThrow('Place search response exceeds the size limit')
  })

  it('skips the provider when the request is already cancelled', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(searchPlaces({ query: 'cafes' }, 'test-key', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
