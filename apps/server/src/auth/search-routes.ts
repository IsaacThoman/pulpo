import { searchConnectInputSchema, type SearchSessionUser } from '@pulpo/contracts'
import { and, eq, gt, lte } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { searchAuthCodes, sessions, users } from '../database/schema.js'
import { resolveClientIp } from '../lib/client-ip.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors.js'
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

function sessionUser(user: SearchSessionUser): SearchSessionUser {
  return { id: user.id, name: user.name, email: user.email }
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
      return { token, expires: session.expiresAt, user: sessionUser(row.user) }
    })
    if (!result) throw unauthorized('Search sign-in has expired. Start again from Pulpo Search.')

    reply.setCookie(cookie.name, result.token, { ...cookie.options, expires: result.expires })
    reply.header('cache-control', 'no-store')
    return { user: result.user }
  })

  app.get('/api/search/auth/session', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const user = request.user
    return { user: user && user.role !== 'pending' ? sessionUser(user) : null }
  })

  app.post('/api/search/auth/logout', async (request, reply) => {
    const cookie = searchCookie(searchOrigin())
    const token = request.cookies[cookie.name]
    if (token) await db.delete(sessions).where(and(eq(sessions.tokenHash, hashToken(token)), eq(sessions.appType, 'search')))
    reply.clearCookie(cookie.name, cookie.options)
    return reply.code(204).send()
  })
}
