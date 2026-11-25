import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, unauthorized } from '../lib/errors.js'
import { registerSearchRoutes } from './routes.js'

const mocks = vi.hoisted(() => ({
  authenticated: true,
  enabled: true,
  settings: {} as Record<string, unknown>,
  fetch: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
}))

vi.mock('../config.js', () => ({
  getConfig: () => ({ SEARCH_PUBLIC_URL: mocks.enabled ? 'https://search.example.com' : undefined, ENCRYPTION_KEY: 'key' }),
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

let app: FastifyInstance
const query = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/search/query', payload })

beforeEach(() => {
  mocks.authenticated = true
  mocks.enabled = true
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
        { id: 'kagi', categories: ['web', 'news', 'images', 'videos', 'podcasts'], maxPage: 10, dates: ['day', 'week', 'month', 'year'], region: true, priceMicros: 12_000 },
        { id: 'firecrawl', categories: ['web', 'news', 'images'], maxPage: 1, priceMicros: 7_000 },
      ],
    })
    expect(response.body).not.toContain('secret')
  })

  it('requires a session for weather and resolves places without a provider call until known and covered', async () => {
    mocks.authenticated = false
    expect((await app.inject('/api/search/weather?location=Paris')).statusCode).toBe(401)
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

  it('keeps scoped provider attempts and fallback inside the same allowed domains', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: {
      search: [{ url: 'https://stackoverflow.com/reference', title: 'Outside explicit site', snippet: 'Outside' }],
      direct_answer: [{ url: 'https://stackoverflow.com/reference', title: 'Outside site', snippet: 'Outside' }],
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
