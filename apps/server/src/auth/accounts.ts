import { and, eq, gt, inArray } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { idSchema, MAX_SIGNED_IN_ACCOUNTS, type SignedInAccount } from '@pulpo/contracts'
import { z } from 'zod'
import { db } from '../database/client.js'
import { sessions, users } from '../database/schema.js'
import { getConfig } from '../config.js'
import { hashToken } from '../lib/crypto.js'
import { AppError, unauthorized } from '../lib/errors.js'
import { serializeUser } from './service.js'

// Browsers keep the active account in the regular HTTP-only session cookie and
// the other signed-in accounts' session tokens in a second HTTP-only cookie.
// Native clients hold one bearer token per account and need none of this.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/

export function signedInAccountsCookieName(): string {
  return `${getConfig().SESSION_COOKIE_NAME}_accounts`
}

export function parseSignedInAccountTokens(value: string | undefined): string[] {
  if (!value) return []
  const tokens = value.split('.').filter((token) => TOKEN_PATTERN.test(token))
  return [...new Set(tokens)].slice(0, MAX_SIGNED_IN_ACCOUNTS - 1)
}

interface ResolvedAccount {
  token: string
  sessionId: string
  expiresAt: Date
  user: typeof users.$inferSelect
}

async function resolveTokens(tokens: string[]): Promise<Map<string, ResolvedAccount>> {
  if (tokens.length === 0) return new Map()
  const byHash = new Map(tokens.map((token) => [hashToken(token), token]))
  const rows = await db.select({ session: sessions, user: users }).from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(inArray(sessions.tokenHash, [...byHash.keys()]), gt(sessions.expiresAt, new Date())))
  const resolved = new Map<string, ResolvedAccount>()
  for (const row of rows) {
    const token = byHash.get(row.session.tokenHash)
    if (token && !row.user.blocked) {
      resolved.set(token, { token, sessionId: row.session.id, expiresAt: row.session.expiresAt, user: row.user })
    }
  }
  return resolved
}

interface SignedInAccounts {
  active: ResolvedAccount | null
  others: ResolvedAccount[]
}

/** Reads both cookies, dropping expired, revoked, and duplicate sessions. */
async function readSignedInAccounts(request: FastifyRequest): Promise<SignedInAccounts & { redundant: string[] }> {
  const config = getConfig()
  const activeToken = request.cookies[config.SESSION_COOKIE_NAME]
  const otherTokens = parseSignedInAccountTokens(request.cookies[signedInAccountsCookieName()])
  const valid = await resolveTokens([...(activeToken && TOKEN_PATTERN.test(activeToken) ? [activeToken] : []), ...otherTokens])
  const active = activeToken ? valid.get(activeToken) ?? null : null
  const seen = new Set(active ? [active.user.id] : [])
  const others: ResolvedAccount[] = []
  const redundant: string[] = []
  for (const token of otherTokens) {
    const account = valid.get(token)
    if (!account || token === activeToken) continue
    // Signing in to an account that is already signed in leaves an older session behind.
    if (seen.has(account.user.id)) {
      redundant.push(account.sessionId)
      continue
    }
    seen.add(account.user.id)
    others.push(account)
  }
  return { active, others, redundant }
}

function writeOtherAccounts(reply: FastifyReply, others: ResolvedAccount[]): void {
  const config = getConfig()
  if (others.length === 0) {
    reply.clearCookie(signedInAccountsCookieName(), { path: '/' })
    return
  }
  const expires = new Date(Math.max(...others.map((account) => account.expiresAt.getTime())))
  reply.setCookie(signedInAccountsCookieName(), others.map((account) => account.token).join('.'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    expires,
  })
}

function setActiveAccount(reply: FastifyReply, account: ResolvedAccount): void {
  const config = getConfig()
  reply.setCookie(config.SESSION_COOKIE_NAME, account.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    expires: account.expiresAt,
  })
}

function serializeAccount(account: ResolvedAccount, active: boolean): SignedInAccount {
  const user = serializeUser(account.user)
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    profileColor: user.profileColor,
    active,
  }
}

async function deleteSessions(ids: string[]): Promise<void> {
  if (ids.length > 0) await db.delete(sessions).where(inArray(sessions.id, ids))
}

const switchAccountInputSchema = z.object({ userId: idSchema })

export async function registerAccountSwitchingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/accounts', async (request, reply) => {
    // A menu refresh can finish after a switch, add, sign-in, or sign-out.
    // Never overwrite newer cookies or revoke sessions from this stale snapshot.
    // Explicit account mutations below still prune invalid and redundant entries.
    const { active, others } = await readSignedInAccounts(request)
    reply.header('cache-control', 'no-store')
    return {
      accounts: [
        ...(active ? [serializeAccount(active, true)] : []),
        ...others.map((account) => serializeAccount(account, false)),
      ],
    }
  })

  // Keeps the current account signed in while the browser signs in to another one.
  app.post('/api/auth/accounts/add', async (request, reply) => {
    const { active, others, redundant } = await readSignedInAccounts(request)
    if (!active) throw unauthorized()
    if (others.length + 1 >= MAX_SIGNED_IN_ACCOUNTS) {
      throw new AppError(409, 'account_limit', `You can stay signed in to up to ${MAX_SIGNED_IN_ACCOUNTS} accounts`)
    }
    await deleteSessions(redundant)
    writeOtherAccounts(reply, [active, ...others])
    reply.clearCookie(getConfig().SESSION_COOKIE_NAME, { path: '/' })
    reply.code(204).send()
  })

  app.post('/api/auth/accounts/switch', async (request, reply) => {
    const { userId } = switchAccountInputSchema.parse(request.body)
    const { active, others, redundant } = await readSignedInAccounts(request)
    if (active?.user.id === userId) return { user: serializeUser(active.user) }
    const target = others.find((account) => account.user.id === userId)
    if (!target) throw new AppError(404, 'account_not_signed_in', 'That account is no longer signed in on this browser')
    await deleteSessions(redundant)
    writeOtherAccounts(reply, [...(active ? [active] : []), ...others.filter((account) => account !== target)])
    setActiveAccount(reply, target)
    return { user: serializeUser(target.user) }
  })

  // Signs out one account that is signed in but not active.
  app.post('/api/auth/accounts/sign-out', async (request, reply) => {
    const { userId } = switchAccountInputSchema.parse(request.body)
    const { active, others, redundant } = await readSignedInAccounts(request)
    if (active?.user.id === userId) {
      throw new AppError(409, 'account_active', 'Use sign out to end the active account session')
    }
    const target = others.find((account) => account.user.id === userId)
    await deleteSessions([...redundant, ...(target ? [target.sessionId] : [])])
    writeOtherAccounts(reply, others.filter((account) => account !== target))
    reply.code(204).send()
  })

  app.post('/api/auth/accounts/sign-out-all', async (request, reply) => {
    const { active, others, redundant } = await readSignedInAccounts(request)
    await deleteSessions([...redundant, ...[active, ...others].flatMap((account) => account ? [account.sessionId] : [])])
    reply.clearCookie(signedInAccountsCookieName(), { path: '/' })
    reply.clearCookie(getConfig().SESSION_COOKIE_NAME, { path: '/' })
    reply.code(204).send()
  })
}
