import argon2 from 'argon2'
import { and, eq, gt } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { User } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { passwordCredentials, sessions, users } from '../database/schema.js'
import { getConfig } from '../config.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { newId } from '../lib/ids.js'
import { forbidden, unauthorized } from '../lib/errors.js'

export interface AuthenticatedUser extends User {}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null
    apiKeyId: string | null
  }
}

function serializeUser(row: typeof users.$inferSelect): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    balanceMicros: row.balanceMicros,
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

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const config = getConfig()
  const token = request.cookies[config.SESSION_COOKIE_NAME]
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
  reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' })
}

export async function authenticateSession(request: FastifyRequest): Promise<AuthenticatedUser | null> {
  const token = request.cookies[getConfig().SESSION_COOKIE_NAME]
  return authenticateSessionToken(token)
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

export async function ensureBootstrapAdmin(): Promise<void> {
  const config = getConfig()
  // Bootstrap is a one-time empty-database operation. Once any account exists,
  // administrators own the user lifecycle and a deleted bootstrap account must
  // not silently return after a restart.
  const [existingUser] = await db.select({ id: users.id }).from(users).limit(1)
  if (existingUser) return
  const userId = newId()
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email: config.BOOTSTRAP_ADMIN_EMAIL,
      name: config.BOOTSTRAP_ADMIN_NAME,
      role: 'admin',
      balanceMicros: config.BOOTSTRAP_ADMIN_BALANCE_MICROS,
    })
    await tx.insert(passwordCredentials).values({
      userId,
      passwordHash: await createPasswordHash(config.BOOTSTRAP_ADMIN_PASSWORD),
    })
  })
}

export { serializeUser }
