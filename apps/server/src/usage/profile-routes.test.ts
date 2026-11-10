import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { ZodError } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageVisibility } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'
import { friendships, models, usageEvents, userBlocks, users } from '../database/schema.js'

type Rows = unknown[] | ((fields: Record<string, unknown> | undefined) => unknown[])

const mocks = vi.hoisted(() => {
  const tables = new Map<unknown, Rows>()
  const queries: { table: unknown; fields: Record<string, unknown> | undefined; where?: unknown }[] = []
  function select(fields?: Record<string, unknown>) {
    const record: (typeof queries)[number] = { table: undefined, fields }
    queries.push(record)
    const query = {
      from: (table: unknown) => { record.table = table; return query },
      innerJoin: () => query, leftJoin: () => query, groupBy: () => query, orderBy: () => query, limit: () => query,
      where: (condition: unknown) => { record.where = condition; return query },
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => {
        const stored = tables.get(record.table) ?? []
        const rows = typeof stored === 'function' ? stored(fields) : stored
        // Mimic the SQL projection so a shared fixture row only returns the selected columns.
        const projected = fields ? rows.map((row) => Object.fromEntries(Object.keys(fields)
          .filter((key) => key in (row as object)).map((key) => [key, (row as Record<string, unknown>)[key]]))) : rows
        return Promise.resolve(projected).then(resolve, reject)
      },
    }
    return query
  }
  return { tables, queries, select, membership: vi.fn(), poolMembers: vi.fn(), poolPeers: vi.fn() }
})
vi.mock('../database/client.js', () => ({
  db: { select: mocks.select, transaction: async (callback: (tx: unknown) => unknown) => callback({}) },
}))
vi.mock('../pools/service.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../pools/service.js')>(),
  activePoolMembership: mocks.membership,
  activePoolMembers: mocks.poolMembers,
  poolPeerIds: mocks.poolPeers,
}))
import { registerFriendRoutes } from '../friends/routes.js'
import { registerUsageRoutes } from './routes.js'

const viewerId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'
const now = new Date('2026-11-09T12:00:00.000Z')

function targetRow(usageVisibility: UsageVisibility) {
  return {
    id: targetId, name: 'Target Person', username: 'target', email: 'target@example.com', role: 'user', blocked: false,
    avatarObjectKey: null, avatarVersion: 0, profileColor: '#10b981', usageVisibility, balanceMicros: 987_654_321,
    createdAt: now, updatedAt: now,
  }
}

const acceptedFriendship = {
  id: '33333333-3333-4333-8333-333333333333', userAId: viewerId, userBId: targetId, requestedByUserId: viewerId,
  status: 'accepted', acceptedAt: now, createdAt: now, updatedAt: now,
}

function pools(byUser: Record<string, string>) {
  mocks.membership.mockImplementation(async (_tx: unknown, userId: string) => (
    byUser[userId] ? { pool: { id: byUser[userId] }, member: {} } : null
  ))
}

function params(condition: unknown): unknown[] {
  return new PgDialect().sqlToQuery(condition as SQL).params
}

let app: FastifyInstance
beforeEach(async () => {
  mocks.tables.clear()
  mocks.queries.length = 0
  mocks.membership.mockReset()
  mocks.poolMembers.mockReset().mockResolvedValue([])
  mocks.poolPeers.mockReset().mockResolvedValue([])
  pools({})
  app = Fastify()
  app.addHook('onRequest', async (request) => {
    request.user = { id: viewerId, role: 'user', blocked: false, balanceMicros: 5 } as FastifyRequest['user']
  })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, type: error.type } })
    return reply.code(error instanceof ZodError ? 400 : 500).send({ error: { code: 'validation_error' } })
  })
  await registerFriendRoutes(app)
  await registerUsageRoutes(app)
})
afterEach(async () => app.close())

describe('GET /api/profiles/:username usageVisible', () => {
  it('is true for accepted friends at the default visibility', async () => {
    mocks.tables.set(users, [targetRow('friends')])
    mocks.tables.set(friendships, [acceptedFriendship])
    const response = await app.inject('/api/profiles/Target')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ relationship: 'friends', usageVisible: true, usageVisibility: 'friends', joinedAt: now.toISOString() })
    expect(response.json().profile).not.toHaveProperty('usageVisibility')
  })

  it('is false for friends outside the Pool when usage is pool-only', async () => {
    mocks.tables.set(users, [targetRow('pool')])
    mocks.tables.set(friendships, [acceptedFriendship])
    pools({ [targetId]: 'pool-1' })
    // The level is shown on the profile even when the usage itself is hidden from this viewer.
    expect((await app.inject('/api/profiles/target')).json()).toMatchObject({ relationship: 'friends', usageVisible: false, usageVisibility: 'pool' })
  })

  it('is true for the viewer\'s own profile', async () => {
    mocks.tables.set(users, [{ ...targetRow('pool'), id: viewerId }])
    expect((await app.inject('/api/profiles/target')).json()).toMatchObject({ relationship: 'self', usageVisible: true })
  })
})

describe('GET /api/profiles/:username/usage/activity', () => {
  it('returns 404 for a missing profile and when either side blocked the other', async () => {
    expect((await app.inject('/api/profiles/nobody/usage/activity')).statusCode).toBe(404)
    mocks.tables.set(users, [targetRow('public')])
    mocks.tables.set(userBlocks, [{ blocker: targetId }])
    const response = await app.inject('/api/profiles/target/usage/activity')
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: { code: 'not_found', type: 'invalid_request_error' } })
    expect(mocks.queries.some((query) => query.table === usageEvents)).toBe(false)
  })

  it('returns usage_private without querying usage when the viewer may not see it', async () => {
    mocks.tables.set(users, [targetRow('friends')])
    pools({ [viewerId]: 'pool-1', [targetId]: 'pool-2' })
    const response = await app.inject('/api/profiles/target/usage/activity')
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: { code: 'usage_private', type: 'permission_error' } })
    expect(mocks.queries.some((query) => query.table === usageEvents)).toBe(false)
  })

  it('returns public activity with private models hidden and no balance', async () => {
    mocks.tables.set(users, [targetRow('public')])
    mocks.tables.set(usageEvents, [{
      day: '2026-11-08', modelId: 'secret-model', modelName: 'Secret Model', modelLogo: 'secret', modelVisible: false,
      calls: 3, inputTokens: 30, cacheWriteTokens: 0, outputTokens: 10, costMicros: 600, inferenceReferenceCostMicros: 700,
      firstUsedAt: '2026-11-08 00:00:00+00',
    }])
    mocks.tables.set(models, [{ modelId: 'secret-model', modelName: 'Secret Model', modelLogo: 'secret', modelVisible: false }])
    const response = await app.inject('/api/profiles/target/usage/activity?range=7d&timeZone=America/Chicago')
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.summary).toMatchObject({ calls: 3, costMicros: 600 })
    expect(body.topModels).toEqual([expect.objectContaining({ modelId: 'other', name: 'Other', logo: null, calls: 3 })])
    expect(body.modelNames).toEqual({ other: 'Other' })
    expect(Object.keys(body).sort()).toEqual(['contribution', 'daily', 'modelNames', 'summary', 'topModels'])
    expect(response.body).not.toMatch(/balance|Secret Model|987654321/i)
    const usageQuery = mocks.queries.find((query) => query.table === usageEvents)!
    expect(params(usageQuery.where)).toContain(targetId)
    expect(params(usageQuery.where)).not.toContain(viewerId)
  })

  it('allows Pool members to see pool-only usage', async () => {
    mocks.tables.set(users, [targetRow('pool')])
    pools({ [viewerId]: 'pool-1', [targetId]: 'pool-1' })
    expect((await app.inject('/api/profiles/target/usage/activity')).statusCode).toBe(200)
  })

  it('validates the range and time zone', async () => {
    mocks.tables.set(users, [targetRow('public')])
    expect((await app.inject('/api/profiles/target/usage/activity?range=1y')).statusCode).toBe(400)
    expect((await app.inject('/api/profiles/target/usage/activity?timeZone=Mars/Base')).statusCode).toBe(400)
  })
})

describe('GET /api/profiles/:username/usage/records', () => {
  const usage = {
    id: '44444444-4444-4444-8444-444444444444', createdAt: now, userId: targetId, apiKeyId: 'api-key-secret',
    responseId: 'response-secret', poolBalanceAfterMicros: 123_123, balanceCostMicros: 77, inputTokens: 12,
    cacheWriteTokens: 0, outputTokens: 4, costMicros: 250, inferenceReferenceCostMicros: 300, weeklyCostMicros: 50,
    sharedCostMicros: 30, customCostMicros: 20, costBreakdown: [],
  }
  const record = {
    usage, userId: targetId, userName: 'Target Person', userUsername: 'target', userAvatarObjectKey: null,
    userAvatarVersion: 0, userProfileColor: '#10b981', modelId: 'secret-model', modelName: 'Secret Model',
    modelLogo: 'secret', modelVisible: false,
  }

  it('returns the shared safe row shape for friends', async () => {
    mocks.tables.set(users, [targetRow('friends')])
    mocks.tables.set(friendships, [acceptedFriendship])
    mocks.tables.set(usageEvents, [record, { ...record, usage: { ...usage, id: '55555555-5555-4555-8555-555555555555' } }])
    const response = await app.inject('/api/profiles/target/usage/records?limit=1&range=all')
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.data).toEqual([{
      id: usage.id,
      createdAt: now.toISOString(),
      participant: { id: targetId, displayName: 'Target Person', username: 'target', avatarUrl: null, profileColor: '#10b981' },
      model: { id: 'other', name: 'Other', logo: null },
      inputTokens: 12, cacheWriteTokens: 0, outputTokens: 4, costMicros: 250, inferenceReferenceCostMicros: 300,
      subscriptionCoveredMicros: 100, costBreakdown: [],
    }])
    expect(body.nextCursor).toEqual(expect.any(String))
    expect(response.body).not.toMatch(/balance|api-key-secret|response-secret|apiKeyId|responseId|123123/i)
  })

  it('returns 403 and 404 under the same rules as activity', async () => {
    mocks.tables.set(users, [targetRow('pool')])
    mocks.tables.set(friendships, [acceptedFriendship])
    expect((await app.inject('/api/profiles/target/usage/records')).json()).toEqual({ error: { code: 'usage_private', type: 'permission_error' } })
    mocks.tables.set(users, [])
    expect((await app.inject('/api/profiles/target/usage/records')).statusCode).toBe(404)
    expect(mocks.queries.some((query) => query.table === usageEvents)).toBe(false)
  })

  it('rejects malformed cursors and limits', async () => {
    mocks.tables.set(users, [targetRow('public')])
    expect((await app.inject('/api/profiles/target/usage/records?cursor=not-a-cursor')).statusCode).toBe(400)
    expect((await app.inject('/api/profiles/target/usage/records?limit=500')).statusCode).toBe(400)
  })
})

describe('GET /api/usage/leaderboard', () => {
  const pooledFriendId = '66666666-6666-4666-8666-666666666666'
  const hiddenFriendId = '77777777-7777-4777-8777-777777777777'

  it('omits balances and pool-only friends outside the viewer\'s Pool', async () => {
    mocks.tables.set(friendships, [targetId, pooledFriendId, hiddenFriendId].map((id) => ({ userAId: viewerId, userBId: id })))
    mocks.tables.set(userBlocks, [])
    mocks.tables.set(users, (fields) => fields && 'calls' in fields
      ? [{ userId: targetId, name: 'Target Person', username: 'target', avatarObjectKey: null, avatarVersion: 0, profileColor: null, balanceMicros: 987_654_321, calls: 2, tokens: 20, costMicros: 100 }]
      : [{ id: pooledFriendId, usageVisibility: 'pool' }, { id: hiddenFriendId, usageVisibility: 'pool' }])
    mocks.poolPeers.mockResolvedValue([pooledFriendId])
    const response = await app.inject('/api/usage/leaderboard?scope=friends')
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([{
      userId: targetId, displayName: 'Target Person', username: 'target', avatarUrl: null, profileColor: null,
      calls: 2, tokens: 20, costMicros: 100,
    }])
    const leaderboard = mocks.queries.find((query) => query.fields && 'calls' in query.fields)!
    expect(leaderboard.fields).not.toHaveProperty('balanceMicros')
    const circle = params(leaderboard.where)
    expect(circle).toEqual(expect.arrayContaining([viewerId, targetId, pooledFriendId]))
    expect(circle).not.toContain(hiddenFriendId)
  })

  it('keeps every active Pool member in the pool scope', async () => {
    pools({ [viewerId]: 'pool-1' })
    mocks.poolMembers.mockResolvedValue([viewerId, hiddenFriendId].map((id) => ({ user: { id } })))
    mocks.tables.set(users, [])
    const response = await app.inject('/api/usage/leaderboard?scope=pool')
    expect(response.statusCode).toBe(200)
    expect(mocks.poolMembers).toHaveBeenCalledWith({}, 'pool-1')
    expect(mocks.queries.filter((query) => query.table === users)).toHaveLength(1)
    expect(params(mocks.queries.find((query) => query.table === users)!.where)).toEqual(expect.arrayContaining([viewerId, hiddenFriendId]))
  })
})
