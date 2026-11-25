import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { placeSearchInput, searchFirecrawlPlaces, searchPlaces } from './places.js'

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
        { name: 'Harbor Coffee', address: '42 Harbor St, San Francisco, CA', category: 'Coffee', weeklyHours: [
          { day: 'Monday', hours: '07:00–18:00' }, { day: 'Tuesday', hours: '07:00–18:00' },
        ] },
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

  it('uses the matching weekday from the weekly schedule when the venue day differs from current_day', async () => {
    vi.setSystemTime(new Date('2026-11-24T02:00:00Z')) // 6 p.m. Monday in San Francisco.
    mockResponse({ type: 'locations', results: [{ ...cafe, opening_hours: {
      current_day: [{ ...tuesday, opens: '08:00', closes: '16:00' }],
      days: [[{ ...monday, opens: '16:00', closes: '20:00' }]],
    } }] })
    const result = await searchPlaces({ query: 'cafes', openNow: true }, 'test-key')
    expect(result.results).toMatchObject([{
      name: 'Harbor Coffee', timezone: 'America/Los_Angeles', todayHours: ['16:00–20:00'], openNow: true,
    }])
    expect(result.results[0]).not.toHaveProperty('weeklyHours')
  })

  it('merges named weekdays without inventing local today, closure or open status when timezone is unavailable', async () => {
    const opening_hours = { current_day: [tuesday], days: [
      [{ abbr_name: 'Sun', opens: '20:00', closes: '02:00' }],
      [{ ...monday, closes: '10:00' }, { ...monday, opens: '12:00' }],
      [{ full_name: 'Friday', opens: '00:00', closes: '24:00' }],
      [{ ...tuesday, abbr_name: 'Wed' }], // Contradictory day labels.
      [], // An unnamed empty day is not an explicit closure.
    ] }
    const listing = { type: 'locations', results: [{ ...cafe, timezone: undefined, opening_hours }] }
    const fetch = mockResponse(listing)
    fetch.mockResolvedValueOnce(Response.json(listing))
    const result = await searchPlaces({ query: 'cafes' }, 'test-key')
    expect(result.results[0]?.weeklyHours).toEqual([
      { day: 'Monday', hours: '07:00–10:00, 12:00–18:00' },
      { day: 'Tuesday', hours: '07:00–18:00' },
      { day: 'Friday', hours: '00:00–24:00' },
      { day: 'Sunday', hours: '20:00–02:00' },
    ])
    expect(result.results[0]).not.toHaveProperty('todayHours')
    expect(result.results[0]).not.toHaveProperty('openNow')
    await expect(searchPlaces({ query: 'cafes', openNow: true }, 'test-key')).resolves.toEqual({
      provider: 'brave', results: [], unverifiedHours: 1,
    })
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

const firecrawlCafe = {
  name: 'Station Coffee', address: '89 E 42nd St, New York, NY 10017', timezone: 'America/New_York',
  opening_hours: [{ date: '2026-11-24', day: 'Tuesday', hours: ['6:30 AM–10 PM'] }],
  business_status: 'operational', website: 'https://station-coffee.example.com/', phone: '(212) 555-0111',
  phone_e164: '+12125550111', categories: ['Coffee shop'], latitude: 40.7524, longitude: -73.9777,
  rating: 4.8, review_count: 86, maps_url: 'https://maps.firecrawl.dev/place/private', feature_id: 'raw-provider-id',
  editorial_summary: '<b>Espresso bar by the station.</b>', price_level: '$$', place_id: 'ChIJx_12StationCoffee',
}

function firecrawlResponse(results: unknown[]) {
  return {
    success: true,
    data: { alexandria: [{ provider: 'firecrawl-maps', capability: 'businesses/search', creditsCost: 10,
      data: { count: results.length, observed_at_ms: 1795543200000, results }, feedbackToken: 'private',
    }] },
  }
}

describe('Firecrawl Maps place search', () => {
  it('uses the hosted Alexandria endpoint and returns only normalized listing fields', async () => {
    const fetch = mockResponse(firecrawlResponse([null, { name: 'No address' }, firecrawlCafe, firecrawlCafe]))
    await expect(searchFirecrawlPlaces({ query: 'coffee shops', location: 'Grand Central Terminal New York' }, 'test-key')).resolves.toEqual({
      provider: 'firecrawl', results: [{
        name: 'Station Coffee', address: '89 E 42nd St, New York, NY 10017', timezone: 'America/New_York',
        todayHours: ['6:30 AM–10 PM'], openNow: true, website: 'https://station-coffee.example.com/',
        phone: '(212) 555-0111', category: 'Coffee shop', coordinates: [40.7524, -73.9777],
        rating: { value: 4.8, max: 5, count: 86 },
        summary: 'Espresso bar by the station.', priceLevel: '$$', googlePlaceId: 'ChIJx_12StationCoffee',
      }],
    })
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api.firecrawl.dev/v2/scrape', expect.objectContaining({
      method: 'POST', redirect: 'error', signal: expect.any(AbortSignal), headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
    }))
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ alexandria: {
      provider: 'firecrawl-maps', capability: 'businesses/search', options: { query: 'coffee shops near Grand Central Terminal New York' },
    } })
  })

  it('uses dates in the business timezone and handles overnight, closed and missing hours', async () => {
    vi.setSystemTime(new Date('2026-11-25T01:00:00Z')) // 8 p.m. Tuesday in New York.
    const today = { date: '2026-11-24', day: 'Tuesday' }
    const tomorrow = { date: '2026-11-25', day: 'Wednesday' }
    const fetch = mockResponse(firecrawlResponse([
      { ...firecrawlCafe, name: 'Closed on Tuesday', opening_hours: [{ ...tomorrow, hours: ['Open 24 hours'] }, { ...today, hours: ['Closed'] }] },
      { ...firecrawlCafe, name: 'Late counter', opening_hours: [{ ...today, hours: ['7 PM–2 AM'] }] },
      { ...firecrawlCafe, name: 'Night cafe', opening_hours: [{ ...today, hours: ['Open 24 hours'] }] },
      { ...firecrawlCafe, name: 'Afternoon cafe', opening_hours: [{ ...today, hours: ['12–11 PM'] }] },
      { ...firecrawlCafe, name: 'On hiatus', business_status: 'temporarily_closed' },
      { ...firecrawlCafe, name: 'Shuttered', business_status: 'permanently_closed' },
      { ...firecrawlCafe, name: 'Call for hours', opening_hours: [{ ...today, hours: ['Call for hours'] }] },
      { ...firecrawlCafe, name: 'Timezone missing', timezone: null },
    ]))
    const query = 'Coffee New York'
    const result = await searchFirecrawlPlaces({ query, location: 'New York', openNow: true }, 'test-key')
    expect(result.results.map(({ name, openNow }) => [name, openNow])).toEqual([
      ['Late counter', true], ['Night cafe', true], ['Afternoon cafe', true],
    ])
    expect(result.unverifiedHours).toBe(2)
    expect(JSON.parse(fetch.mock.calls[0]![1].body).alexandria.options.query).toBe(query)
  })

  it('only considers an overnight interval in the early morning when yesterday is supplied', async () => {
    vi.setSystemTime(new Date('2026-11-25T06:00:00Z')) // 1 a.m. Wednesday in New York.
    const yesterday = { date: '2026-11-24', day: 'Tuesday', hours: ['7 PM–2 AM'] }
    const today = { date: '2026-11-25', day: 'Wednesday', hours: ['7 PM–2 AM'] }
    mockResponse(firecrawlResponse([
      { ...firecrawlCafe, name: 'Known overnight', opening_hours: [{ ...today, hours: ['Closed'] }, yesterday] },
      { ...firecrawlCafe, name: 'Unknown overnight', opening_hours: [today] },
      { ...firecrawlCafe, name: 'Known closed', opening_hours: [today, { ...yesterday, hours: ['Closed'] }] },
    ]))
    const result = await searchFirecrawlPlaces({ query: 'coffee' }, 'test-key')
    expect(result.results.map(({ name, openNow, todayHours }) => [name, openNow, todayHours])).toEqual([
      ['Known overnight', true, ['Closed']], ['Unknown overnight', undefined, ['7 PM–2 AM']], ['Known closed', false, ['7 PM–2 AM']],
    ])
  })

  it('rejects errors and terms requirements without exposing private provider details', async () => {
    const fetch = mockResponse({ success: true, data: { alexandria: [{
      provider: 'firecrawl-maps', capability: 'businesses/search', code: 'THIRD_PARTY_DATA_TERMS_REQUIRED',
      requiresAction: { url: 'https://example.com/private-action' },
    }] } })
    await expect(searchFirecrawlPlaces({ query: 'coffee' }, 'test-key')).rejects.toThrow('Unexpected place search response')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
