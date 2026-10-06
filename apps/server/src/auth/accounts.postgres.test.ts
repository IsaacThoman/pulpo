import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { MAX_SIGNED_IN_ACCOUNTS } from '@pulpo/contracts'
import { db, queryClient } from '../database/client.js'
import { sessions, users } from '../database/schema.js'
import { hashToken } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { parseSignedInAccountTokens, registerAccountSwitchingRoutes } from './accounts.js'

const enabled = process.env.PULPO_ACCOUNT_SWITCHING_POSTGRES_TEST === '1'
const userIds = Array.from({ length: MAX_SIGNED_IN_ACCOUNTS + 1 }, () => randomUUID())
const [personalId, workId, thirdId] = userIds as [string, string, string]
let app: FastifyInstance

async function session(userId: string, patch: Partial<typeof sessions.$inferInsert> = {}) {
  const id = randomUUID(), token = `s${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`
  await db.insert(sessions).values({ id, userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000), ...patch })
  return { id, token }
}

function cookies(active?: string, others: string[] = []) {
  return [
    ...(active ? [`pulpo_session=${active}`] : []),
    ...(others.length ? [`pulpo_session_accounts=${others.join('.')}`] : []),
  ].join('; ')
}

function setCookies(response: { cookies: Array<{ name: string; value: string; expires?: Date }> }) {
  const byName = new Map(response.cookies.map((entry) => [entry.name, entry]))
  const read = (name: string) => {
    const entry = byName.get(name)
    if (!entry) return undefined
    return entry.expires && entry.expires.getTime() <= Date.now() ? '' : entry.value
  }
  return { active: read('pulpo_session'), others: read('pulpo_session_accounts') }
}

async function sessionExists(id: string) {
  return (await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id))).length === 1
}

describe('signed-in account cookie parsing', () => {
  it('keeps unique well-formed tokens up to the account limit', () => {
    const token = (character: string) => character.repeat(43)
    expect(parseSignedInAccountTokens(undefined)).toEqual([])
    expect(parseSignedInAccountTokens(`${token('a')}.short.${token('a')}.${token('b')}`)).toEqual([token('a'), token('b')])
    expect(parseSignedInAccountTokens('abcdefghij'.split('').map(token).join('.'))).toHaveLength(MAX_SIGNED_IN_ACCOUNTS - 1)
  })
})

describe.skipIf(!enabled)('account switching with PostgreSQL', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.includes('/pulpo_account_switching_test')) throw new Error('Use a disposable pulpo_account_switching_test database')
    await app?.close()
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local client_min_messages = warning`)
      await tx.execute(sql`truncate users cascade`)
    })
    for (const id of userIds) {
      await db.insert(users).values({ id, role: 'user', name: `Account ${id.slice(0, 4)}`, email: `${id}@example.test`, username: `u${id.replaceAll('-', '')}` })
    }
    app = Fastify()
    await app.register(cookie)
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ code: error instanceof AppError ? error.code : undefined }))
    await registerAccountSwitchingRoutes(app)
  })
  afterAll(async () => {
    await app?.close()
    await queryClient.end()
  })

  it('lists the active account first and prunes revoked, expired, and duplicate sessions', async () => {
    const personal = await session(personalId)
    const work = await session(workId)
    const staleWork = await session(workId)
    const expired = await session(thirdId, { expiresAt: new Date(Date.now() - 1_000) })
    const duplicateActive = await session(personalId)
    const response = await app.inject({ url: '/api/auth/accounts', headers: { cookie: cookies(personal.token, [work.token, staleWork.token, expired.token, duplicateActive.token, 'x'.repeat(43)]) } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().accounts.map((account: { id: string; active: boolean }) => [account.id, account.active])).toEqual([[personalId, true], [workId, false]])
    expect(setCookies(response).others).toBe(work.token)
    expect(await sessionExists(staleWork.id)).toBe(false)
    expect(await sessionExists(duplicateActive.id)).toBe(false)
    expect(await sessionExists(work.id)).toBe(true)
  })

  it('keeps the current account signed in while adding another', async () => {
    const personal = await session(personalId)
    const add = await app.inject({ method: 'POST', url: '/api/auth/accounts/add', headers: { cookie: cookies(personal.token) } })
    expect(add.statusCode).toBe(204)
    expect(setCookies(add)).toEqual({ active: '', others: personal.token })
    expect(await sessionExists(personal.id)).toBe(true)

    const listed = await app.inject({ url: '/api/auth/accounts', headers: { cookie: cookies(undefined, [personal.token]) } })
    expect(listed.json().accounts).toEqual([expect.objectContaining({ id: personalId, active: false })])
    expect((await app.inject({ method: 'POST', url: '/api/auth/accounts/add', headers: { cookie: cookies(undefined, [personal.token]) } })).statusCode).toBe(401)
  })

  it('refuses to add beyond the account limit', async () => {
    const all = await Promise.all(userIds.slice(0, MAX_SIGNED_IN_ACCOUNTS).map((id) => session(id)))
    const response = await app.inject({ method: 'POST', url: '/api/auth/accounts/add', headers: { cookie: cookies(all[0]!.token, all.slice(1).map((entry) => entry.token)) } })
    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('account_limit')
  })

  it('swaps the active account with a signed-in one', async () => {
    const personal = await session(personalId)
    const work = await session(workId)
    const third = await session(thirdId)
    const response = await app.inject({ method: 'POST', url: '/api/auth/accounts/switch', headers: { cookie: cookies(personal.token, [work.token, third.token]) }, payload: { userId: workId } })
    expect(response.statusCode).toBe(200)
    expect(response.json().user.id).toBe(workId)
    expect(setCookies(response)).toEqual({ active: work.token, others: `${personal.token}.${third.token}` })

    const missing = await app.inject({ method: 'POST', url: '/api/auth/accounts/switch', headers: { cookie: cookies(personal.token) }, payload: { userId: workId } })
    expect(missing.statusCode).toBe(404)
  })

  it('returns to a signed-in account after abandoning a new sign-in', async () => {
    const personal = await session(personalId)
    const response = await app.inject({ method: 'POST', url: '/api/auth/accounts/switch', headers: { cookie: cookies(undefined, [personal.token]) }, payload: { userId: personalId } })
    expect(response.statusCode).toBe(200)
    expect(setCookies(response)).toEqual({ active: personal.token, others: '' })
  })

  it('signs out one inactive account or every account', async () => {
    const personal = await session(personalId)
    const work = await session(workId)
    const third = await session(thirdId)
    const active = await app.inject({ method: 'POST', url: '/api/auth/accounts/sign-out', headers: { cookie: cookies(personal.token, [work.token]) }, payload: { userId: personalId } })
    expect(active.statusCode).toBe(409)

    const one = await app.inject({ method: 'POST', url: '/api/auth/accounts/sign-out', headers: { cookie: cookies(personal.token, [work.token, third.token]) }, payload: { userId: workId } })
    expect(one.statusCode).toBe(204)
    expect(setCookies(one).others).toBe(third.token)
    expect(await sessionExists(work.id)).toBe(false)
    expect(await sessionExists(personal.id)).toBe(true)

    const all = await app.inject({ method: 'POST', url: '/api/auth/accounts/sign-out-all', headers: { cookie: cookies(personal.token, [third.token]) } })
    expect(all.statusCode).toBe(204)
    expect(setCookies(all)).toEqual({ active: '', others: '' })
    expect(await sessionExists(personal.id)).toBe(false)
    expect(await sessionExists(third.id)).toBe(false)
  })

  it('ignores blocked accounts', async () => {
    const personal = await session(personalId)
    const work = await session(workId)
    await db.update(users).set({ blocked: true }).where(eq(users.id, workId))
    const response = await app.inject({ url: '/api/auth/accounts', headers: { cookie: cookies(personal.token, [work.token]) } })
    expect(response.json().accounts.map((account: { id: string }) => account.id)).toEqual([personalId])
    expect(setCookies(response).others).toBe('')
  })
})
