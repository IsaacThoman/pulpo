import { randomUUID } from 'node:crypto'
import cookie from '@fastify/cookie'
import { defaultSearchAccountPreferences } from '@pulpo/contracts/search'
import { eq } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import { searchAuthCodes, sessions, userPreferences, users } from '../database/schema.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { applyManagementSettings, loadManagementSettings } from '../management/settings.js'
import { registerAccountSwitchingRoutes, signedInAccountsCookieName } from './accounts.js'
import { searchAccountSummary } from '../search/account.js'
import { authenticateApplicationRequest, registerSearchAuthRoutes } from './search-routes.js'
import { requireUser } from './service.js'

vi.mock('../config.js', async (original) => {
  const config = await original<typeof import('../config.js')>()
  return {
    ...config,
    getConfig: () => config.parseConfig({
      ...process.env,
      PUBLIC_URL: 'https://pulpo.test',
      SEARCH_PUBLIC_URL: 'https://search.pulpo.test',
      SESSION_COOKIE_NAME: 'search_test_session',
    }),
  }
})

const enabled = process.env.PULPO_SEARCH_AUTH_TESTS === 'true'
const pulpoHeaders = { host: 'pulpo.test', origin: 'https://pulpo.test' }
const searchHeaders = { host: 'search.pulpo.test', origin: 'https://search.pulpo.test' }
const mainCookieName = 'search_test_session'
const searchCookieName = `__Host-${mainCookieName}_search`
const authorizeUrl = '/api/auth/search/authorize'
const exchangeUrl = '/api/search/auth/exchange'
const searchSessionUrl = '/api/search/auth/session'

describe.skipIf(!enabled)('Search sessions and Pulpo account handoff', () => {
  let app: FastifyInstance
  let testUser: { id: string; email: string; name: string }
  let sourceSessionId: string
  let sourceToken: string
  let sourceCookie: string

  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL ?? 'postgres://localhost').pathname !== '/pulpo_search_auth_test') {
      throw new Error('Run this suite against a disposable pulpo_search_auth_test PostgreSQL database')
    }
    app = Fastify()
    await app.register(cookie)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (request) => { request.user = await authenticateApplicationRequest(request) })
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) return reply.code(error.statusCode).send({ code: error.code })
      return reply.send(error)
    })
    app.get('/api/test-account', async (request) => ({ id: requireUser(request).id }))
    await registerAccountSwitchingRoutes(app)
    registerSearchAuthRoutes(app)
  })
  beforeEach(async () => {
    const id = randomUUID()
    testUser = { id, name: 'Search test user', email: `${id}@example.test` }
    await db.insert(users).values({ ...testUser, username: `u${id.replaceAll('-', '').slice(0, 25)}`, role: 'user' })
    sourceSessionId = randomUUID()
    sourceToken = randomToken()
    sourceCookie = `${mainCookieName}=${sourceToken}`
    await db.insert(sessions).values({
      id: sourceSessionId, userId: id, tokenHash: hashToken(sourceToken), appType: 'web',
      expiresAt: new Date(Date.now() + 60_000),
    })
  })
  afterEach(async () => { if (testUser) await db.delete(users).where(eq(users.id, testUser.id)) })
  afterAll(async () => {
    await app?.close()
    await queryClient.end()
  })

  async function authorize() {
    const codeVerifier = randomToken()
    const state = randomToken()
    const response = await app.inject({
      method: 'POST', url: authorizeUrl, headers: { ...pulpoHeaders, cookie: sourceCookie },
      payload: { codeChallenge: hashToken(codeVerifier), state, userId: testUser.id },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const redirect = new URL(response.json().redirectUrl)
    expect(redirect.origin + redirect.pathname).toBe('https://search.pulpo.test/auth/callback')
    expect(redirect.searchParams.get('state')).toBe(state)
    const code = redirect.searchParams.get('code')!
    expect(code).toHaveLength(43)
    return { code, codeVerifier }
  }

  function exchange(payload: { code: string; codeVerifier: string }, headers = searchHeaders) {
    return app.inject({ method: 'POST', url: exchangeUrl, headers, payload })
  }

  it('requires same-origin browser requests and keeps Pulpo and Search sessions separate', async () => {
    const payload = await authorize()
    expect((await exchange(payload, { ...searchHeaders, origin: 'https://preview.pulpo.test' })).statusCode).toBe(403)
    expect((await exchange(payload, pulpoHeaders)).statusCode).toBe(404)
    expect((await exchange({ ...payload, codeVerifier: randomToken() })).statusCode).toBe(401)
    const mainSession = await app.inject({ url: searchSessionUrl, headers: { ...searchHeaders, cookie: sourceCookie } })
    expect(mainSession.json()).toEqual({ user: null })

    const response = await exchange(payload)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ user: { ...testUser, avatarUrl: null } })
    expect(response.headers['cache-control']).toBe('no-store')
    const setCookie = response.headers['set-cookie'] as string
    expect(setCookie).toMatch(new RegExp(`^${searchCookieName}=`))
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).not.toContain('Domain=')
    const searchCookie = setCookie.split(';')[0]!
    const token = searchCookie.split('=')[1]!
    const browserSession = await app.inject({ url: searchSessionUrl, headers: { host: searchHeaders.host, cookie: searchCookie } })
    expect(browserSession.json()).toEqual({ user: { ...testUser, avatarUrl: null } })
    expect((await app.inject({ url: searchSessionUrl, headers: { ...pulpoHeaders, cookie: searchCookie } })).statusCode).toBe(404)
    expect((await app.inject({ url: '/api/test-account', headers: { ...pulpoHeaders, authorization: `Bearer ${token}` } })).statusCode).toBe(401)
    expect((await app.inject({ url: '/api/test-account', headers: { ...pulpoHeaders, cookie: `${mainCookieName}=${token}` } })).statusCode).toBe(401)
    const accounts = await app.inject({ url: '/api/auth/accounts', headers: {
      ...pulpoHeaders, cookie: `${signedInAccountsCookieName()}=${token}`,
    } })
    expect(accounts.json()).toEqual({ accounts: [] })

    const [session] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).limit(1)
    expect(session).toMatchObject({ appType: 'search', deviceLabel: 'Pulpo Search', userId: testUser.id })
    const logoutUrl = '/api/search/auth/logout'
    const searchCookies = { ...searchHeaders, cookie: searchCookie }
    expect((await app.inject({ method: 'POST', url: logoutUrl, headers: { host: searchHeaders.host, cookie: searchCookie } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: logoutUrl, headers: searchCookies })).statusCode).toBe(204)
    expect((await app.inject({ url: searchSessionUrl, headers: searchCookies })).json()).toEqual({ user: null })
    expect((await app.inject({ url: '/api/test-account', headers: { ...pulpoHeaders, cookie: sourceCookie } })).statusCode).toBe(200)
    expect((await exchange(payload)).statusCode).toBe(401)
  })

  it('allows only one exchange when the callback is repeated concurrently', async () => {
    const payload = await authorize()
    const results = await Promise.all([exchange(payload), exchange(payload)])
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 401])
  })

  it('shares only the active account palette with an authenticated Search session', async () => {
    const url = '/api/search/appearance'
    expect((await app.inject({ url, headers: searchHeaders })).statusCode).toBe(401)
    await db.insert(userPreferences).values({
      userId: testUser.id,
      values: {
        theme: 'dark', colorTheme: 'lagoon', unrelated: 'private preference',
        customThemes: [{ id: 'lagoon', name: 'Lagoon', css: '.test { color: red }', dark: { colors: { 'editor.background': '#102632' } } }],
      },
    })
    const exchanged = await exchange(await authorize())
    const response = await app.inject({ url, headers: {
      ...searchHeaders, cookie: (exchanged.headers['set-cookie'] as string).split(';')[0],
    } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      theme: 'dark', colorTheme: 'lagoon',
      customTheme: {
        id: 'lagoon', name: 'Lagoon', css: '',
        dark: { colors: { 'editor.background': '#102632' }, tokenColors: [] },
        light: { colors: {}, tokenColors: [] },
      },
    })
  })

  it('isolates Search preferences and atomically imports local defaults only into a new account', async () => {
    const url = '/api/search/preferences'
    const accountId = testUser.id
    const readUrl = `${url}?accountId=${accountId}`
    expect((await app.inject({ url: readUrl, headers: searchHeaders })).statusCode).toBe(401)
    await db.insert(userPreferences).values({ userId: accountId, values: { theme: 'dark', unrelated: 'keep' } })
    const exchanged = await exchange(await authorize())
    const headers = { ...searchHeaders, cookie: (exchanged.headers['set-cookie'] as string).split(';')[0] }
    const get = (id = accountId) => app.inject({ url: `${url}?accountId=${id}`, headers })
    const patch = (payload: object, origin = searchHeaders.origin) => app.inject({
      method: 'PATCH', url, headers: { ...headers, origin }, payload: { accountId, ...payload },
    })

    const before = await get()
    expect(before.headers['cache-control']).toBe('no-store')
    expect(before.json()).toEqual({ preferences: null })
    expect((await get(randomUUID())).statusCode).toBe(403)
    expect((await patch({ accountId: randomUUID(), patch: { limit: 10 } })).statusCode).toBe(403)
    expect((await patch({ patch: { limit: 10 } }, pulpoHeaders.origin)).statusCode).toBe(403)

    const initial = { ...defaultSearchAccountPreferences, limit: 20, domains: { 'example.com': 'hide' } }
    const imported = await patch({ initial, patch: {} })
    expect(imported.statusCode).toBe(200)
    expect(imported.json()).toEqual({ preferences: initial })
    const concurrent = await Promise.all([
      patch({ patch: { newTab: true } }),
      patch({ initial: defaultSearchAccountPreferences, patch: { defaultRegion: 'gb', safeSearch: false } }),
    ])
    expect(concurrent.map(response => response.statusCode)).toEqual([200, 200])
    const categoryProviders = { images: { defaultProvider: 'firecrawl', fallbackProvider: 'none' } }
    expect((await patch({ patch: { categoryProviders } })).statusCode).toBe(200)
    expect((await patch({ patch: { categoryProviders: { web: categoryProviders.images } } })).statusCode).not.toBe(200)
    const expected = { ...initial, newTab: true, defaultRegion: 'gb', safeSearch: false, categoryProviders }
    expect((await get()).json()).toEqual({ preferences: expected })
    const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, accountId))
    expect(row?.values).toMatchObject({ theme: 'dark', unrelated: 'keep', searchPreferences: expected })

    const document = await loadManagementSettings(accountId)
    document.account.theme = 'light'
    const updated = await applyManagementSettings(accountId, accountId, document, document.revision, {}, 'account')
    expect(updated.account.theme).toBe('light')
    expect((await get()).json()).toEqual({ preferences: expected })
  })

  it('rejects a grant after the source session is revoked or the code expires', async () => {
    const expired = await authorize()
    await db.update(searchAuthCodes).set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(searchAuthCodes.tokenHash, hashToken(expired.code)))
    expect((await exchange(expired)).statusCode).toBe(401)

    const revoked = await authorize()
    await db.delete(sessions).where(eq(sessions.id, sourceSessionId))
    expect((await exchange(revoked)).statusCode).toBe(401)
  })

  it('checks the expected active account before issuing a code', async () => {
    const payload = { codeChallenge: hashToken(randomToken()), state: randomToken(), userId: randomUUID() }
    const response = await app.inject({ method: 'POST', url: authorizeUrl, headers: { ...pulpoHeaders, cookie: sourceCookie }, payload })
    expect(response.statusCode).toBe(403)
  })

  it('serves the profile picture through Search and reports the account balance', async () => {
    await db.update(users).set({ avatarObjectKey: `users/${testUser.id}/avatar/test.webp`, avatarVersion: 4, balanceMicros: 7_250_000 })
      .where(eq(users.id, testUser.id))
    const response = await exchange(await authorize())
    expect(response.json()).toEqual({ user: { ...testUser, avatarUrl: `/api/search/avatar/${testUser.id}?v=4` } })
    const searchCookie = (response.headers['set-cookie'] as string).split(';')[0]!
    const session = await app.inject({ url: searchSessionUrl, headers: { ...searchHeaders, cookie: searchCookie } })
    expect(session.json().user.avatarUrl).toBe(`/api/search/avatar/${testUser.id}?v=4`)
    const otherAccount = await app.inject({ url: `/api/search/avatar/${randomUUID()}`, headers: { ...searchHeaders, cookie: searchCookie } })
    expect(otherAccount.statusCode).toBe(404)
    expect(await searchAccountSummary(testUser.id)).toEqual({
      billing: false, balanceMicros: 7_250_000, poolBalanceMicros: null, limits: [],
    })

    await db.update(users).set({ avatarObjectKey: null }).where(eq(users.id, testUser.id))
    const avatar = await app.inject({ url: `/api/search/avatar/${testUser.id}`, headers: { ...searchHeaders, cookie: searchCookie } })
    expect(avatar.statusCode).toBe(404)
    expect((await app.inject({ url: `/api/search/avatar/${testUser.id}`, headers: searchHeaders })).statusCode).toBe(401)
  })
})
