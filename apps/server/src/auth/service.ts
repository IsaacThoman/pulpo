import argon2 from 'argon2'
import { AsyncLocalStorage } from 'node:async_hooks'
import { and, eq, gt, ne } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { User } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { sessions, users } from '../database/schema.js'
import { getConfig } from '../config.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { newId } from '../lib/ids.js'
import { forbidden, unauthorized } from '../lib/errors.js'
import { publishSessionRevocation } from '../responses/events.js'
import { profileAvatarUrl } from '../profile/service.js'

export interface AuthenticatedUser extends User {}

const internalAuthenticatedUser = new AsyncLocalStorage<AuthenticatedUser>()

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null
    apiKeyId: string | null
    rawBody: string | null
  }
}

function serializeUser(row: typeof users.$inferSelect): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    username: row.username,
    avatarUrl: profileAvatarUrl(row),
    profileColor: row.profileColor,
    role: row.role,
    balanceMicros: row.balanceMicros,
    storageLimitBytes: row.storageLimitBytes,
    blocked: row.blocked,
    stateRevision: row.stateRevision,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function createPasswordHash(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 })
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}

export async function createSession(
  userId: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const config = getConfig()
  const token = randomToken()
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000)
  await db.insert(sessions).values({
    id: newId(),
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: request.headers['user-agent'],
    ipAddress: request.ip,
  })
  reply.setCookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    expires: expiresAt,
  })
}

export interface NativeSessionResult {
  token: string
  expiresAt: string
}

export async function createNativeSession(
  userId: string,
  deviceLabel: string,
  request: FastifyRequest,
): Promise<NativeSessionResult> {
  const config = getConfig()
  const token = randomToken()
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000)
  await db.insert(sessions).values({
    id: newId(),
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    deviceLabel,
    userAgent: request.headers['user-agent'],
    ipAddress: request.ip,
  })
  return { token, expiresAt: expiresAt.toISOString() }
}

export function bearerSessionToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(authorization)
  return match?.[1]
}

export function requestSessionToken(request: Pick<FastifyRequest, 'cookies' | 'headers'>): string | undefined {
  const cookieToken = request.cookies[getConfig().SESSION_COOKIE_NAME]
  return cookieToken ?? bearerSessionToken(request.headers.authorization)
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const config = getConfig()
  const token = request.cookies[config.SESSION_COOKIE_NAME]
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
  reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' })
}

export async function destroyNativeSession(request: FastifyRequest): Promise<void> {
  const token = bearerSessionToken(request.headers.authorization)
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
}

export async function revokeOtherSessions(request: FastifyRequest, userId: string): Promise<void> {
  const currentToken = requestSessionToken(request)
  if (!currentToken) throw unauthorized()
  const [current] = await db.select({ id: sessions.id }).from(sessions).where(and(
    eq(sessions.userId, userId),
    eq(sessions.tokenHash, hashToken(currentToken)),
    gt(sessions.expiresAt, new Date()),
  )).limit(1)
  if (!current) throw unauthorized()
  await revokeOtherSessionsById(userId, current.id)
}

export async function currentSessionId(request: FastifyRequest, userId: string): Promise<string> {
  const token = requestSessionToken(request)
  if (!token) throw unauthorized()
  const [current] = await db.select({ id: sessions.id }).from(sessions).where(and(
    eq(sessions.userId, userId),
    eq(sessions.tokenHash, hashToken(token)),
    gt(sessions.expiresAt, new Date()),
  )).limit(1)
  if (!current) throw unauthorized()
  return current.id
}

export async function revokeOtherSessionsById(userId: string, currentSessionId: string): Promise<void> {
  await db.delete(sessions).where(and(
    eq(sessions.userId, userId),
    ne(sessions.id, currentSessionId),
  ))
  await publishSessionRevocation(userId)
}

export async function authenticateSession(request: FastifyRequest): Promise<AuthenticatedUser | null> {
  const internal = internalAuthenticatedUser.getStore()
  if (internal) return internal
  return authenticateSessionToken(requestSessionToken(request))
}

export function runWithAuthenticatedUser<T>(user: AuthenticatedUser, operation: () => T): T {
  return internalAuthenticatedUser.run(user, operation)
}

export async function authenticateSessionToken(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1)
  if (!row || row.user.blocked) return null
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id))
  return serializeUser(row.user)
}

export function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) throw unauthorized()
  if (request.user.role === 'pending') throw forbidden('Your account is pending approval')
  if (request.user.blocked) throw forbidden('Your account is blocked')
  return request.user
}

export function requireAdmin(request: FastifyRequest): AuthenticatedUser {
  const user = requireUser(request)
  if (user.role !== 'admin') throw forbidden('Administrator access required')
  return user
}

export { serializeUser }
