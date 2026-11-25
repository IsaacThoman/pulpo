import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, unauthorized } from '../lib/errors.js'
import { registerSearchRoutes } from './routes.js'

const mocks = vi.hoisted(() => ({
  authenticated: true,
  enabled: true,
  placeKey: undefined as string | undefined,
  firecrawlPlacePrice: undefined as number | undefined,
  quickCapability: vi.fn(),
  quickStart: vi.fn(),
  quickStream: vi.fn(),
  quickCancel: vi.fn(),
  openverse: false,
  settings: {} as Record<string, unknown>,
  fetch: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
}))

vi.mock('../config.js', () => ({
  getConfig: () => ({
    SEARCH_PUBLIC_URL: mocks.enabled ? 'https://search.example.com' : undefined,
    SEARCH_BRAVE_PLACES_API_KEY: mocks.placeKey,
    SEARCH_FIRECRAWL_PLACES_PRICE_MICROS: mocks.firecrawlPlacePrice,
    SEARCH_OPENVERSE_ENABLED: mocks.openverse,
    ENCRYPTION_KEY: 'key',
  }),
}))
vi.mock('../lib/crypto.js', () => ({ decryptSecret: (value: string) => value }))
vi.mock('../auth/service.js', () => ({
  requireUser: () => {
    if (!mocks.authenticated) throw unauthorized()
    return { id: 'search-user' }
  },
}))
vi.mock('../accounting/service.js', () => ({
  reserveMeteredBudget: mocks.reserve,
  settleMeteredBudget: mocks.settle,
  releaseMeteredBudget: mocks.release,
}))
vi.mock('../database/client.js', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ value: mocks.settings }] }) }) }) },
}))
vi.mock('./quick-answer.js', () => ({
  quickAnswerCapability: mocks.quickCapability, startQuickAnswer: mocks.quickStart,
  streamQuickAnswer: mocks.quickStream, cancelQuickAnswer: mocks.quickCancel,
}))

let app: FastifyInstance
const quickId = '00000000-0000-4000-8000-000000000001'
const query = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/search/query', payload })
const places = (payload: Record<string, unknown>, remoteAddress?: string) =>
  app.inject({ method: 'POST', url: '/api/search/places', payload, remoteAddress })
const quickAnswer = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/search/quick-answer', payload })
const reusableImages = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/search/reusable-images', payload })

beforeEach(async () => {
  mocks.authenticated = true
  mocks.enabled = true
  mocks.placeKey = undefined
  mocks.firecrawlPlacePrice = undefined
  mocks.quickCapability.mockReset().mockResolvedValue(undefined)
  mocks.quickStart.mockReset()
  mocks.quickStream.mockReset()
  mocks.quickCancel.mockReset()
  mocks.openverse = false
  mocks.settings = {
    searchEnabled: true,
    searchProviderOrder: ['kagi', 'firecrawl'],
    encryptedKagiApiKey: 'kagi-secret',
    encryptedFirecrawlApiKey: 'firecrawl-secret',
    kagi: { searchEnabled: true, billSearches: true, searchPriceMicros: 12_000 },
    firecrawl: { searchEnabled: true, billSearches: true, searchPriceMicros: 7_000 },
  }
  mocks.fetch.mockReset()
  mocks.reserve.mockReset().mockResolvedValueOnce('kagi-hold').mockResolvedValueOnce('firecrawl-hold')
  mocks.settle.mockReset().mockResolvedValue(7000)
  mocks.release.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', mocks.fetch)
  app = Fastify()
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code } })
    return reply.code(400).send({ error: { code: 'validation_error' } })
  })
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => new AppError(context.statusCode, 'rate_limit_exceeded', 'Rate limit exceeded'),
  })
  app.addHook('onRequest', async request => {
    request.user = mocks.authenticated ? { id: 'search-user' } as FastifyRequest['user'] : null
  })
  registerSearchRoutes(app)
})

afterEach(async () => {
  await app.close()
  vi.unstubAllGlobals()
})

describe('Pulpo Search API', () => {
  it('proxies only bounded image resources for valid public result hosts', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 1, 0]), { headers: { 'content-type': 'image/x-icon' } }))
    const response = await app.inject('/api/search/favicon/github.com')
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, max-age=86400')
    expect(response.headers['content-type']).toBe('image/x-icon')
    expect(mocks.fetch).toHaveBeenLastCalledWith('https://icons.duckduckgo.com/ip3/github.com.ico', expect.objectContaining({ redirect: 'error' }))
    expect((await app.inject('/api/search/favicon/private.local')).statusCode).toBe(404)
    expect((await app.inject('/api/search/favicon/node.tailnet.ts.net')).statusCode).toBe(404)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    mocks.fetch.mockResolvedValueOnce(new Response('<svg>unsafe</svg>', { headers: { 'content-type': 'image/svg+xml' } }))
    expect((await app.inject('/api/search/favicon/wikipedia.org')).statusCode).toBe(404)
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array(65537), { headers: { 'content-type': 'image/x-icon' } }))
    expect((await app.inject('/api/search/favicon/iana.org')).statusCode).toBe(404)
  })

  it('advertises the configured hostname for browser search discovery without signing in', async () => {
    mocks.authenticated = false
    const response = await app.inject('/api/search/opensearch.xml')
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/opensearchdescription+xml')
    expect(response.body).toContain('template="https://search.example.com/search?q={searchTerms}"')
  })

  it('exposes enabled providers and configured prices without credentials', async () => {
    const response = await app.inject('/api/search/config')
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({
      defaultOrder: ['kagi', 'firecrawl'],
      weather: true,
      providers: [
        { id: 'kagi', categories: ['web', 'news', 'images', 'videos', 'podcasts'], maxPage: 10, dates: ['day', 'week', 'month', 'year'], customDateRanges: ['web', 'news'], region: true, priceMicros: 12_000 },
        { id: 'firecrawl', categories: ['web', 'news', 'images'], maxPage: 1, customDateRanges: ['web', 'news'], priceMicros: 7_000 },
      ],
    })
    expect(response.body).not.toContain('secret')
  })

  it('makes Openverse a separate opt-in lookup without debiting Web search credits', async () => {
    expect((await app.inject('/api/search/config')).json()).not.toHaveProperty('reusableImages')
    expect((await reusableImages({ query: 'Hokusai' })).statusCode).toBe(404)
    expect(mocks.fetch).not.toHaveBeenCalled()
    mocks.openverse = true
    expect((await app.inject('/api/search/config')).json().reusableImages).toBe(true)
    mocks.authenticated = false
    expect((await reusableImages({ query: 'Hokusai' })).statusCode).toBe(401)
    mocks.authenticated = true
    mocks.fetch.mockResolvedValueOnce(Response.json({ page: 1, page_count: 0, results: [] }))
    const response = await reusableImages({ query: 'Hokusai', license: 'public-domain' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ provider: 'openverse', results: [] })
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.reserve).not.toHaveBeenCalled()
  })

  it('honors an upstream Openverse cooldown for subsequent searches', async () => {
    mocks.openverse = true
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '20' } }))
    const response = await reusableImages({ query: 'Hokusai' })
    expect(response.statusCode).toBe(429)
    expect(response.headers['retry-after']).toBe('20')
    const blocked = await reusableImages({ query: 'Turner' })
    expect(blocked.statusCode).toBe(429)
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })

  it('distinguishes Openverse timeouts from other upstream failures without returning provider data', async () => {
    mocks.openverse = true
    const timeout = new AbortController()
    const clock = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeout.signal)
    mocks.fetch.mockImplementationOnce(async () => {
      timeout.abort(new DOMException('upstream timeout', 'TimeoutError'))
      throw timeout.signal.reason
    }).mockResolvedValueOnce(new Response('private upstream details', { status: 503 }))
    try {
      const expired = await reusableImages({ query: 'Monet' })
      expect(expired.statusCode).toBe(504)
      expect(expired.json()).toEqual({ error: { code: 'reusable_images_timeout' } })
      const unavailable = await reusableImages({ query: 'van Gogh' })
      expect(unavailable.statusCode).toBe(502)
      expect(unavailable.json()).toEqual({ error: { code: 'reusable_images_unavailable' } })
    } finally { clock.mockRestore() }
  })

  it('advertises Places through the session-bound config only when its server key is set', async () => {
    expect((await app.inject('/api/search/config')).json()).not.toHaveProperty('places')
    expect((await places({ query: 'coffee' })).statusCode).toBe(404)
    mocks.placeKey = 'brave-test-secret'
    const config = await app.inject('/api/search/config')
    expect(config.json()).toMatchObject({ defaultOrder: ['kagi', 'firecrawl'], places: { provider: 'brave', priceMicros: 5000 } })
    expect(config.body).not.toContain('brave-test-secret')
    mocks.authenticated = false
    expect((await places({ query: 'coffee' })).statusCode).toBe(401)
    expect((await app.inject('/api/search/config')).statusCode).toBe(401)
    mocks.authenticated = true
    mocks.enabled = false
    expect((await places({ query: 'coffee' })).statusCode).toBe(404)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('lists the agent model for an authenticated Search session and validates the Quick Answer start contract', async () => {
    expect((await app.inject('/api/search/config')).json()).not.toHaveProperty('quickAnswer')
    mocks.quickCapability.mockResolvedValue({ modelName: 'Default model' })
    expect((await app.inject('/api/search/config')).json().quickAnswer).toEqual({ modelName: 'Default model' })
    for (const input of [{ query: 'hi' }, { query: ' ', requestId: quickId }, { query: 'a'.repeat(501), requestId: quickId },
      { query: 'hi', requestId: 'invalid' }, { query: 'hi', requestId: quickId, modelId: 'untrusted' }]) {
      expect((await quickAnswer(input)).statusCode).toBe(400)
    }
    expect(mocks.quickStart).not.toHaveBeenCalled()
    mocks.quickStart.mockResolvedValueOnce({ responseId: quickId, modelName: 'Default model' })
    const response = await quickAnswer({ query: ' tide pools ', requestId: quickId })
    expect(response.statusCode).toBe(202)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ responseId: quickId, modelName: 'Default model' })
    expect(mocks.quickStart).toHaveBeenCalledExactlyOnceWith('search-user', { query: 'tide pools', requestId: quickId }, undefined)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('requires a Search session for Quick Answer start, stream and cancel', async () => {
    const events = '/api/search/quick-answer/' + quickId + '/events'
    const cancel = '/api/search/quick-answer/' + quickId + '/cancel'
    mocks.authenticated = false
    expect((await quickAnswer({ query: 'tide pools', requestId: quickId })).statusCode).toBe(401)
    expect((await app.inject(events)).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: cancel })).statusCode).toBe(401)
    expect(mocks.quickStart).not.toHaveBeenCalled()
    expect(mocks.quickStream).not.toHaveBeenCalled()
    expect(mocks.quickCancel).not.toHaveBeenCalled()
    mocks.authenticated = true
    mocks.quickStream.mockImplementationOnce((reply: FastifyReply) => reply.type('text/event-stream').send('data: {"type":"done"}\n\n'))
    expect((await app.inject(events)).body).toBe('data: {"type":"done"}\n\n')
    expect(mocks.quickStream).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'search-user', quickId)
    expect((await app.inject({ method: 'POST', url: cancel })).statusCode).toBe(204)
    expect(mocks.quickCancel).toHaveBeenCalledExactlyOnceWith('search-user', quickId)
  })

  it('validates typed place inputs and reserves credits before fetching results', async () => {
    mocks.placeKey = 'brave-test-secret'
    for (const input of [{ query: ' ' }, { query: 'q'.repeat(501) }, { query: 'ok', location: 'x'.repeat(151) },
      { query: 'ok', openNow: 'true' }, { query: 'ok', latitude: 40 }]) {
      expect((await places(input)).statusCode).toBe(400)
    }
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    mocks.fetch.mockResolvedValueOnce(Response.json({ type: 'locations', results: [
      { type: 'location_result', title: 'Coffee Shop', postal_address: { displayAddress: '12 Main St, Boston' } },
    ] }))
    const response = await places({ query: 'coffee', location: 'Boston' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ provider: 'brave', results: [{ name: 'Coffee Shop', address: '12 Main St, Boston' }] })
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith({ userId: 'search-user', costMicros: 5000 })
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetch.mock.invocationCallOrder[0]!)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.settle).toHaveBeenCalledExactlyOnceWith({
      reservationId: 'kagi-hold', costMicros: 5000, type: 'web_search',
      metadata: { provider: 'brave', category: 'places', resultCount: 1 },
    })
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it('selects the shared hosted Firecrawl key and configured Places price when opted in', async () => {
    mocks.placeKey = 'brave-test-secret'
    mocks.firecrawlPlacePrice = 12000
    const config = await app.inject('/api/search/config')
    expect(config.json().places).toEqual({ provider: 'firecrawl', priceMicros: 12000 })
    expect(config.body).not.toContain('secret')
    mocks.fetch.mockResolvedValueOnce(Response.json({ success: true, data: { alexandria: [{
      provider: 'firecrawl-maps', capability: 'businesses/search', data: { results: [{ name: 'Coffee Shop', address: '12 Main St, Boston' }] },
    }] } }))
    const response = await places({ query: 'coffee', location: 'Boston' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ provider: 'firecrawl', results: [{ name: 'Coffee Shop', address: '12 Main St, Boston' }] })
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith({ userId: 'search-user', costMicros: 12000 })
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetch.mock.invocationCallOrder[0]!)
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith('https://api.firecrawl.dev/v2/scrape', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer firecrawl-secret' }),
    }))
    expect(mocks.settle).toHaveBeenCalledExactlyOnceWith({
      reservationId: 'kagi-hold', costMicros: 12000, type: 'web_search',
      metadata: { provider: 'firecrawl', category: 'places', resultCount: 1 },
    })
  })

  it('disables Places for Firecrawl configurations without a hosted key', async () => {
    mocks.placeKey = 'brave-test-secret'
    mocks.firecrawlPlacePrice = 12000
    mocks.settings.firecrawl = { baseUrl: 'https://firecrawl.example.com/v2' }
    expect((await app.inject('/api/search/config')).json()).not.toHaveProperty('places')
    expect((await places({ query: 'coffee' })).statusCode).toBe(404)
    mocks.settings.firecrawl = { baseUrl: 'https://api.firecrawl.dev/v2' }
    mocks.settings.encryptedFirecrawlApiKey = null
    expect((await app.inject('/api/search/config')).json()).not.toHaveProperty('places')
    expect((await places({ query: 'coffee' })).statusCode).toBe(404)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('releases failed Firecrawl Places billing without falling back or exposing upstream terms links', async () => {
    mocks.placeKey = 'brave-test-secret'
    mocks.firecrawlPlacePrice = 12000
    mocks.fetch.mockResolvedValueOnce(Response.json({ success: false, code: 'THIRD_PARTY_DATA_TERMS_REQUIRED',
      requiresAction: { url: 'https://example.com/private-action' },
    }, { status: 403 }))
    const response = await places({ query: 'coffee' })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: { code: 'places_unavailable' } })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('kagi-hold')
    expect(mocks.settle).not.toHaveBeenCalled()
  })

  it('releases empty and failed Places attempts and does not fetch when credits fall short', async () => {
    mocks.placeKey = 'brave-test-secret'
    mocks.fetch.mockResolvedValueOnce(Response.json({ type: 'locations', results: [
      { title: 'Unknown hours', postal_address: { displayAddress: '12 Main St, Boston' } },
    ] })).mockResolvedValueOnce(new Response('secret upstream error', { status: 401 }))
    const empty = await places({ query: 'coffee', openNow: true })
    expect(empty.json()).toEqual({ provider: 'brave', results: [], unverifiedHours: 1 })
    const failed = await places({ query: 'coffee' })
    expect(failed.statusCode).toBe(502)
    expect(failed.json()).toEqual({ error: { code: 'places_unavailable' } })
    expect(failed.body).not.toContain('secret')
    expect(mocks.release.mock.calls).toEqual([['kagi-hold'], ['firecrawl-hold']])
    mocks.reserve.mockRejectedValueOnce(new AppError(402, 'insufficient_balance', 'Insufficient balance'))
    expect((await places({ query: 'coffee' })).statusCode).toBe(402)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.settle).not.toHaveBeenCalled()
  })

  it('bounds Places attempts per account even if the client address changes', async () => {
    mocks.placeKey = 'brave-test-secret'
    mocks.reserve.mockReset().mockResolvedValue('place-hold')
    mocks.fetch.mockImplementation(async () => Response.json({ type: 'locations' }))
    for (let index = 1; index <= 12; index += 1) {
      expect((await places({ query: 'coffee' }, '192.0.2.' + index)).statusCode).toBe(200)
    }
    expect((await places({ query: 'coffee' }, '192.0.2.13')).statusCode).toBe(429)
    expect(mocks.reserve).toHaveBeenCalledTimes(12)
    expect(mocks.fetch).toHaveBeenCalledTimes(12)
    expect(mocks.release).toHaveBeenCalledTimes(12)
  })

  it('requires a session for weather and resolves places without a provider call until known and covered', async () => {
    mocks.authenticated = false
    expect((await app.inject('/api/search/weather?location=Paris')).statusCode).toBe(401)
    expect((await app.inject('/api/search/weather/alerts?location=Paris')).statusCode).toBe(401)
    mocks.authenticated = true
    const ambiguous = await app.inject('/api/search/weather?location=Paris')
    expect(ambiguous.json()).toMatchObject({
      status: 'ambiguous', places: expect.arrayContaining([{ name: 'Paris', admin: 'Île-de-France', country: 'France', timeZone: 'Europe/Paris', query: 'Paris, Île-de-France, France' }]),
      sources: [{ name: 'GeoNames' }],
    })
    expect((await app.inject('/api/search/weather?location=Paris%2C%20France')).json()).toMatchObject({
      status: 'unavailable', place: { name: 'Paris', country: 'France' },
    })
    expect((await app.inject('/api/search/weather?location=near%20me')).json()).toMatchObject({ status: 'not-found' })
    expect((await app.inject('/api/search/weather/alerts?location=Paris%2C%20France')).json()).toEqual({ status: 'unavailable' })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.reserve).not.toHaveBeenCalled()
  })

  it('releases a failed attempt before billing only the successful fallback provider', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: [{ message: 'Unavailable' }] }, { status: 503 }))
    mocks.fetch.mockResolvedValueOnce(Response.json({
      success: true, data: { news: [{ url: 'https://example.com/article', title: 'Article', snippet: 'Some news', date: '2026-11-01' }] },
    }))
    const response = await query({ query: 'current events', category: 'news', region: 'ca', date: 'year' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      provider: 'firecrawl',
      results: [{ url: 'https://example.com/article', title: 'Article', snippet: 'Some news', publishedAt: '2026-11-01' }],
    })
    expect(JSON.parse(mocks.fetch.mock.calls[1]![1].body)).toMatchObject({ sources: ['news'], country: 'CA', tbs: 'qdr:y' })
    expect(mocks.reserve.mock.calls).toEqual([[{ userId: 'search-user', costMicros: 12_000 }], [{ userId: 'search-user', costMicros: 7_000 }]])
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('kagi-hold')
    expect(mocks.release.mock.invocationCallOrder[0]).toBeLessThan(mocks.reserve.mock.invocationCallOrder[1]!)
    expect(mocks.settle).toHaveBeenCalledExactlyOnceWith({
      reservationId: 'firecrawl-hold', costMicros: 7_000, type: 'web_search',
      metadata: { provider: 'firecrawl', category: 'news', resultCount: 1 },
    })
  })

  it('follows the requested order and returns empty successes without billing', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ success: true, data: { web: [] } }))
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: { search: [] } }))
    const response = await query({ query: 'no matches', providers: ['firecrawl', 'kagi'] })
    expect(response.json()).toEqual({ provider: 'firecrawl', results: [] })
    expect(mocks.reserve.mock.calls.map(([input]) => input.costMicros)).toEqual([7_000, 12_000])
    expect(mocks.release).toHaveBeenCalledTimes(2)
    expect(mocks.settle).not.toHaveBeenCalled()
  })

  it('returns knowledge-only Kagi results without calling a second provider', async () => {
    const infobox = { url: 'https://en.wikipedia.org/wiki/Tallinn', title: 'Tallinn', snippet: '<b>Tallinn</b> is the capital of Estonia.' }
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: { infobox: [infobox] } }))

    const response = await query({ query: 'Tallinn Estonia' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      provider: 'kagi', results: [], hasMore: false,
      knowledge: { url: infobox.url, title: infobox.title, summary: 'Tallinn is the capital of Estonia.', facts: [] },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.settle).toHaveBeenCalledExactlyOnceWith({
      reservationId: 'kagi-hold', costMicros: 12_000, type: 'web_search',
      metadata: { provider: 'kagi', category: 'web', resultCount: 0 },
    })
  })

  it('honors a requested image count and expands only an explicit Kagi gallery', async () => {
    const image = { url: 'https://example.com/images', title: 'Photo', image: { url: 'https://cdn.example.com/photo.jpg' } }
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: { image: [image] } }))
      .mockResolvedValueOnce(Response.json({ data: { image: [image] } }))
    const options = { query: 'a photo', providers: ['kagi'], category: 'images', limit: 1 }
    expect((await query(options)).statusCode).toBe(200)
    expect((await query({ ...options, expandedImages: true })).statusCode).toBe(200)
    expect(mocks.fetch.mock.calls.map(([, request]) => JSON.parse(request.body).limit)).toEqual([1, 120])
    expect(mocks.settle).toHaveBeenCalledTimes(2)
  })

  it('keeps scoped provider attempts and fallback inside the same allowed domains', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: {
      search: [{ url: 'https://stackoverflow.com/reference', title: 'Outside explicit site', snippet: 'Outside' }],
      direct_answer: [{ url: 'https://stackoverflow.com/reference', title: 'Outside site', snippet: 'Outside' }],
      infobox: [{ url: 'https://en.wikipedia.org/wiki/Python_(programming_language)', title: 'Outside knowledge', snippet: 'Outside' }],
    } }))
    mocks.fetch.mockResolvedValueOnce(Response.json({ success: true, data: { web: [
      { url: 'https://docs.python.org.evil.example/article', title: 'Wrong domain', snippet: 'Outside' },
      { url: 'https://examples.docs.python.org/reference', title: 'Real subdomain', snippet: 'Content' },
    ] } }))
    const response = await query({ query: 'list comprehension SITE:Python.ORG.', scope: 'developer' })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toMatchObject({
      query: 'list comprehension', lens: { sites_included: ['docs.python.org'] },
    })
    expect(JSON.parse(mocks.fetch.mock.calls[1]![1].body)).toMatchObject({
      query: 'list comprehension', includeDomains: ['docs.python.org'],
    })
    expect(response.json()).toEqual({
      provider: 'firecrawl',
      results: [{ url: 'https://examples.docs.python.org/reference', title: 'Real subdomain', snippet: 'Content' }],
    })
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('kagi-hold')
    expect(mocks.settle).toHaveBeenCalledTimes(1)
  })

  it('preserves quoted operators and honors actual site exclusions on results and related content', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: {
      search: [
        { url: 'https://forum.example.com/talk', title: 'Excluded subdomain', snippet: 'Hidden' },
        { url: 'https://myexample.com/guide', title: 'Different domain', snippet: 'Visible' },
      ],
      direct_answer: [{ title: 'Unlinked', snippet: 'Unknown domain' }],
      related_search: [{ title: 'Unscoped related query' }],
    } }))
    const response = await query({ query: '"literal site:docs.test" -site:example.com', providers: ['kagi'] })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toMatchObject({
      query: '"literal site:docs.test"', lens: { sites_excluded: ['example.com'] },
    })
    expect(response.json()).toEqual({
      provider: 'kagi',
      results: [{ url: 'https://myexample.com/guide', title: 'Different domain', snippet: 'Visible' }],
      hasMore: false,
    })
  })

  it('returns empty without charging for impossible filters or an out-of-focus site', async () => {
    for (const payload of [
      { query: 'climate site:reddit.com', scope: 'academic' },
      { query: 'climate site:docs.example.com -site:example.com' },
    ]) {
      const response = await query(payload)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ provider: 'kagi', results: [] })
    }
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('validates the category for search focus while still allowing typed site restrictions on news', async () => {
    expect((await query({ query: 'current events', category: 'news', scope: 'academic' })).statusCode).toBe(400)
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: {
      news: [{ url: 'https://www.reuters.com/article', title: 'News', snippet: 'News text' }],
    } }))
    const response = await query({ query: 'current events site:reuters.com', category: 'news', providers: ['kagi'] })
    expect(response.statusCode).toBe(200)
    expect(response.json().results).toHaveLength(1)
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toMatchObject({
      workflow: 'news', query: 'current events', lens: { sites_included: ['reuters.com'] },
    })
  })

  it.each([
    { category: 'videos', group: 'video', url: 'https://www.youtube.com/watch?v=Tuw8hxrFBH8' },
    { category: 'podcasts', group: 'podcast', url: 'https://open.spotify.com/episode/pulpo' },
  ])('uses Kagi’s native $category workflow and consumes only its corresponding result group', async ({ category, group, url }) => {
    const imageUrl = 'https://p.kagi.com/proxy/thumbnail'
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: {
      [group]: [{ url, title: 'Playback source', snippet: 'Match', image: { url: imageUrl }, time: '2026-11-20' }],
      search: [{ url: 'https://example.com/related', title: 'Unrelated page' }],
      podcast_creator: [{ url: 'https://example.com/creator', title: 'Different result group' }],
      direct_answer: [{ url: 'https://example.com/answer', title: 'Unrelated answer', snippet: 'Answer text' }],
    } }))
    const response = await query({ query: 'example media', category, providers: ['firecrawl', 'kagi'], limit: 1 })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      provider: 'kagi', results: [{ url, title: 'Playback source', snippet: 'Match', imageUrl, publishedAt: '2026-11-20' }], hasMore: true,
    })
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith('https://kagi.com/api/v1/search', expect.objectContaining({
      body: expect.stringContaining('"workflow":"' + category + '"'),
    }))
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith({ userId: 'search-user', costMicros: 12_000 })
  })

  it('forwards the requested Kagi page and ends pagination at its supported cap', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: {
      search: [{ url: 'https://example.com/end', title: 'Last page', snippet: 'Content' }],
      direct_answer: [{ title: 'First-page answer', snippet: 'Answer text' }],
      related_search: [{ title: 'First-page suggestion' }],
    } }))
    const response = await query({ query: 'example', page: 10, limit: 1, providers: ['firecrawl', 'kagi'] })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      provider: 'kagi', results: [{ url: 'https://example.com/end', title: 'Last page', snippet: 'Content' }], hasMore: false,
    })
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toMatchObject({ page: 10, workflow: 'search' })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect((await query({ query: 'example', page: 11 })).statusCode).toBe(400)
  })

  it('rejects unsupported provider requests before charging and never substitutes generic web results', async () => {
    expect((await query({ query: 'media', category: 'videos', providers: ['firecrawl'] })).statusCode).toBe(400)
    expect((await query({ query: 'page', page: 2, providers: ['firecrawl'] })).statusCode).toBe(400)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: [{ message: 'Unavailable' }] }, { status: 503 }))
    expect((await query({ query: 'media', category: 'podcasts', providers: ['kagi', 'firecrawl'] })).statusCode).toBe(502)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })

  it('preserves the requested date range when the configured fallback answers', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: { news: [] } }))
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: { news: [
      { url: 'https://example.com/story', title: 'In range', description: 'Example story', date: '2024-02-29' },
    ] } }))
    const response = await query({
      query: 'example story', category: 'news', region: 'gb', dateRange: { from: '2024-02-28', to: '2024-02-29' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      provider: 'firecrawl', results: [{ title: 'In range', publishedAt: '2024-02-29' }],
    })
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toMatchObject({
      workflow: 'news', filters: { after: '2024-02-28', before: '2024-03-01', region: 'GB' },
    })
    expect(JSON.parse(mocks.fetch.mock.calls[1]![1].body)).toMatchObject({
      sources: ['news'], tbs: 'cdr:1,cd_min:02/28/2024,cd_max:02/29/2024', country: 'GB',
    })
  })

  it('rejects impossible dates, reversed ranges, and incompatible filters before billing', async () => {
    const range = { from: '2024-02-29', to: '2024-02-29' }
    for (const filters of [
      { dateRange: { ...range, to: '2024-02-28' } },
      { dateRange: { ...range, to: '2024-02-30' } },
      { dateRange: { ...range, from: '0000-02-29' } },
      { dateRange: { from: range.from } },
      { dateRange: range, date: 'week' },
      { dateRange: range, category: 'images' },
    ]) {
      expect((await query({ query: 'example', ...filters })).statusCode).toBe(400)
    }
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('avoids unfunded provider calls and never expands a one-provider selection', async () => {
    mocks.reserve.mockReset().mockRejectedValue(new AppError(402, 'insufficient_balance', 'Insufficient balance'))
    const response = await query({ query: 'something', providers: ['kagi'] })
    expect(response.statusCode).toBe(402)
    expect(mocks.reserve).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated, disabled and invalid searches before calling providers', async () => {
    mocks.authenticated = false
    expect((await query({ query: 'something' })).statusCode).toBe(401)
    mocks.authenticated = true
    mocks.enabled = false
    expect((await query({ query: 'something' })).statusCode).toBe(404)
    mocks.enabled = true
    expect((await query({ query: 'something', providers: ['kagi', 'kagi'], limit: 21 })).statusCode).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
