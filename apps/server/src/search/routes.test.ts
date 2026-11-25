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
      providers: [
        { id: 'kagi', categories: ['web', 'news', 'images'], dates: ['day', 'week', 'month', 'year'], region: true, priceMicros: 12_000 },
        { id: 'firecrawl', priceMicros: 7_000 },
      ],
    })
    expect(response.body).not.toContain('secret')
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
