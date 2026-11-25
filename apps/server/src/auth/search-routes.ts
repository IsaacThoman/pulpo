import { colorThemeIdSchema, customThemesSchema, DEFAULT_COLOR_THEME_ID, INSTANCE_COLOR_THEME_PREFIX, INSTANCE_COLOR_THEMES_SETTING_KEY, searchConnectInputSchema, type SearchSessionUser } from '@pulpo/contracts'
import { defaultSearchAccountPreferences, SEARCH_ACCOUNT_PREFERENCES_KEY } from '@pulpo/contracts/search'
import { and, eq, gt, lte } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings, searchAuthCodes, sessions, userPreferences, users } from '../database/schema.js'
import { resolveClientIp } from '../lib/client-ip.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors.js'
import { patchAccountPreferences } from '../settings/account-preferences.js'
import { parseInstanceColorThemes } from '../settings/instance-color-themes.js'
import { getBlobStore } from '../storage/index.js'
import { savedSearchPreferences, searchPreferencesAccountQuery, searchPreferencesUpdate } from '../settings/search-preferences.js'
import { authenticateSession, authenticateSessionToken, currentSessionId, newSessionCredentials, requireUser } from './service.js'

const SEARCH_API_PATH = '/api/search'
const CODE_TTL_MS = 60_000
const exchangeInputSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
})
const authorizeInputSchema = searchConnectInputSchema.extend({ userId: z.uuid() })

function searchOrigin(): string {
  const origin = getConfig().SEARCH_PUBLIC_URL
  if (!origin) throw notFound('Pulpo Search')
  return origin
}

function searchCookie(origin: string) {
  const secure = origin.startsWith('https:')
  const prefix = secure ? '__Host-' : ''
  return {
    name: `${prefix}${getConfig().SESSION_COOKIE_NAME}_search`,
    options: { path: '/', httpOnly: true, secure, sameSite: 'lax' as const },
  }
}

/** Authenticated browser requests must arrive through the expected public host. */
function verifyBrowserOrigin(request: FastifyRequest, origin: string) {
  if (request.headers.host !== new URL(origin).host) {
    throw notFound('Pulpo Search')
  }
  const readOnly = request.method === 'GET' || request.method === 'HEAD'
  const requestOrigin = request.headers.origin
  if (requestOrigin !== origin && (!readOnly || requestOrigin !== undefined)) {
    throw new AppError(403, 'origin_mismatch', 'Request origin is not allowed', 'permission_error')
  }
}

export async function authenticateApplicationRequest(request: FastifyRequest) {
  const route = request.routeOptions.url
  if (route !== SEARCH_API_PATH && !route?.startsWith(`${SEARCH_API_PATH}/`)) {
    return authenticateSession(request)
  }
  const origin = searchOrigin()
  verifyBrowserOrigin(request, origin)
  const token = request.cookies[searchCookie(origin).name]
  return authenticateSessionToken(token, resolveClientIp(request.raw, getConfig()), 'search')
}

/** Search runs on its own origin, so the profile picture is served through a Search route. */
function searchAvatarUrl(version: number | null): string | null {
  return version === null ? null : `${SEARCH_API_PATH}/avatar?v=${version}`
}

function avatarVersion(avatarUrl: string | null): number | null {
  if (!avatarUrl) return null
  const version = Number(new URL(avatarUrl, 'http://pulpo.invalid').searchParams.get('v'))
  return Number.isSafeInteger(version) ? version : 0
}

function sessionUser(user: Pick<SearchSessionUser, 'id' | 'name' | 'email'>, avatar: number | null): SearchSessionUser {
  return { id: user.id, name: user.name, email: user.email, avatarUrl: searchAvatarUrl(avatar) }
}

export function registerSearchAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/search/authorize', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const config = getConfig()
    const origin = searchOrigin()
    verifyBrowserOrigin(request, new URL(config.PUBLIC_URL).origin)
    if (!request.cookies[config.SESSION_COOKIE_NAME]) throw unauthorized()
    const user = requireUser(request)
    const input = authorizeInputSchema.parse(request.body)
    if (user.id !== input.userId) throw forbidden('The active Pulpo account changed. Reload and try again.')

    const sourceSessionId = await currentSessionId(request, user.id)
    const now = new Date()
    const code = randomToken()
    await db.delete(searchAuthCodes).where(lte(searchAuthCodes.expiresAt, now))
    await db.insert(searchAuthCodes).values({
      tokenHash: hashToken(code),
      sourceSessionId,
      pkceChallenge: input.codeChallenge,
      searchOrigin: origin,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    })
    const redirect = new URL('/auth/callback', origin)
    redirect.searchParams.set('code', code)
    redirect.searchParams.set('state', input.state)
    reply.header('cache-control', 'no-store')
    return { redirectUrl: redirect.toString() }
  })

  app.post('/api/search/auth/exchange', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const origin = searchOrigin()
    const cookie = searchCookie(origin)
    const input = exchangeInputSchema.parse(request.body)
    const result = await db.transaction(async (tx) => {
      const now = new Date()
      const [authorization] = await tx.delete(searchAuthCodes).where(and(
        eq(searchAuthCodes.tokenHash, hashToken(input.code)),
        eq(searchAuthCodes.pkceChallenge, hashToken(input.codeVerifier)),
        eq(searchAuthCodes.searchOrigin, origin),
        gt(searchAuthCodes.expiresAt, now),
      )).returning({ sourceSessionId: searchAuthCodes.sourceSessionId })
      if (!authorization) return null

      const [row] = await tx.select({ user: users }).from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.id, authorization.sourceSessionId), gt(sessions.expiresAt, now))).limit(1)
      if (!row || row.user.blocked || row.user.role === 'pending') return null

      const previousToken = request.cookies[cookie.name]
      if (previousToken) await tx.delete(sessions).where(and(
        eq(sessions.tokenHash, hashToken(previousToken)),
        eq(sessions.appType, 'search'),
      ))
      const { token, session } = newSessionCredentials(row.user.id, request)
      await tx.insert(sessions).values({ ...session, appType: 'search', deviceLabel: 'Pulpo Search' })
      return { token, expires: session.expiresAt, user: sessionUser(row.user, row.user.avatarObjectKey ? row.user.avatarVersion : null) }
    })
    if (!result) throw unauthorized('Search sign-in has expired. Start again from Pulpo Search.')

    reply.setCookie(cookie.name, result.token, { ...cookie.options, expires: result.expires })
    reply.header('cache-control', 'no-store')
    return { user: result.user }
  })

  app.get('/api/search/auth/session', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const user = request.user
    return { user: user && user.role !== 'pending' ? sessionUser(user, avatarVersion(user.avatarUrl)) : null }
  })

  app.get('/api/search/avatar', async (request, reply) => {
    const user = requireUser(request)
    const [profile] = await db.select({ key: users.avatarObjectKey, version: users.avatarVersion })
      .from(users).where(eq(users.id, user.id)).limit(1)
    if (!profile?.key) throw notFound('Profile picture')
    const etag = `"search-avatar-${user.id}-${profile.version}"`
    reply.header('cache-control', 'private, max-age=31536000, immutable').header('etag', etag)
    if (request.headers['if-none-match'] === etag) return reply.code(304).send()
    return reply.type('image/webp').send(Buffer.from(await getBlobStore().get(profile.key)))
  })

  app.get('/api/search/appearance', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const user = requireUser(request)
    const [row] = await db.select({ values: userPreferences.values }).from(userPreferences)
      .where(eq(userPreferences.userId, user.id)).limit(1)
    const preferences = row?.values as Record<string, unknown> | undefined
    const theme = z.enum(['system', 'light', 'dark']).catch('system').parse(preferences?.theme)
    const colorTheme = colorThemeIdSchema.catch(DEFAULT_COLOR_THEME_ID).parse(preferences?.colorTheme)
    if (colorTheme.startsWith(INSTANCE_COLOR_THEME_PREFIX)) {
      const [setting] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
        .where(eq(applicationSettings.key, INSTANCE_COLOR_THEMES_SETTING_KEY)).limit(1)
      const selected = parseInstanceColorThemes(setting?.value).find(item => INSTANCE_COLOR_THEME_PREFIX + item.id === colorTheme)
      return { theme, colorTheme, instanceTheme: selected }
    }
    const selected = customThemesSchema.catch([]).parse(preferences?.customThemes).find(item => item.id === colorTheme)
    // Search applies Pulpo's color palette without carrying chat-specific custom styles across origins.
    return { theme, colorTheme, customTheme: selected && { ...selected, css: '' } }
  })

  app.get('/api/search/preferences', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const user = requireUser(request)
    const { accountId } = searchPreferencesAccountQuery.parse(request.query)
    if (user.id !== accountId) throw forbidden('The active Search account changed. Reload and try again.')
    const [row] = await db.select({ values: userPreferences.values }).from(userPreferences)
      .where(eq(userPreferences.userId, user.id)).limit(1)
    return { preferences: savedSearchPreferences(row?.values as Record<string, unknown> | undefined) }
  })

  app.patch('/api/search/preferences', {
    bodyLimit: 512 * 1024,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const user = requireUser(request)
    const { accountId, patch, initial } = searchPreferencesUpdate.parse(request.body)
    if (user.id !== accountId) throw forbidden('The active Search account changed. Reload and try again.')
    const changed = Object.keys(patch).length > 0
    const values = await patchAccountPreferences(user.id, existing => {
      const saved = savedSearchPreferences(existing)
      if (!changed && (saved || !initial)) return
      return { [SEARCH_ACCOUNT_PREFERENCES_KEY]: { ...(saved ?? initial ?? defaultSearchAccountPreferences), ...patch } }
    })
    return { preferences: savedSearchPreferences(values) }
  })

  app.post('/api/search/auth/logout', async (request, reply) => {
    const cookie = searchCookie(searchOrigin())
    const token = request.cookies[cookie.name]
    if (token) await db.delete(sessions).where(and(eq(sessions.tokenHash, hashToken(token)), eq(sessions.appType, 'search')))
    reply.clearCookie(cookie.name, cookie.options)
    return reply.code(204).send()
  })
}
