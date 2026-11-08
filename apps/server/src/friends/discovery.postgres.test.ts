import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { friendProfileViewSchema, friendsListSchema } from '@pulpo/contracts'
import { db, queryClient } from '../database/client.js'
import { friendships, userBlocks, users } from '../database/schema.js'
import { friendSuggestions, loadMutualFriends } from './discovery.js'
import { orderedPair, registerFriendRoutes } from './routes.js'

const auth = vi.hoisted(() => ({ userId: '' }))
vi.mock('../auth/service.js', () => ({ requireUser: () => ({ id: auth.userId }) }))
vi.mock('./sync.js', () => ({ bumpAccountRevisions: async () => [], publishScopedStateChanges: async () => {} }))
vi.mock('../pools/service.js', () => ({ publishPoolChanges: async () => {}, separatePoolOnBlock: async () => [] }))

const enabled = process.env.PULPO_FRIENDS_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_friends_test') {
  throw new Error('Friend discovery tests require a disposable database named pulpo_friends_test')
}
const created: string[] = []
async function person(username: string, options: { blocked?: boolean; role?: 'pending' | 'user' } = {}) {
  const id = randomUUID()
  created.push(id)
  await db.insert(users).values({ id, name: username, username: `${username}_${id.slice(0, 8)}`, email: `${id}@test.invalid`, role: 'user', ...options })
  return id
}
async function connect(a: string, b: string, status: 'pending' | 'accepted' = 'accepted', requester = a) {
  const [userAId, userBId] = orderedPair(a, b)
  await db.insert(friendships).values({ id: randomUUID(), userAId, userBId, requestedByUserId: requester, status })
}
async function block(blockerUserId: string, blockedUserId: string) {
  await db.insert(userBlocks).values({ blockerUserId, blockedUserId })
}

describe.skipIf(!enabled)('PostgreSQL friend discovery', () => {
  afterEach(async () => {
    if (created.length) await db.delete(users).where(inArray(users.id, created.splice(0)))
  })
  afterAll(async () => { await queryClient.end() })

  it('ranks distinct friends of friends by mutual count, caps at six, and excludes every direct relationship', async () => {
    const me = await person('viewer')
    const a = await person('mutual_a')
    const b = await person('mutual_b')
    await connect(me, a)
    await connect(b, me)
    const candidates = await Promise.all(Array.from({ length: 10 }, (_, i) => person(`candidate_${i}`)))
    for (const id of candidates) await connect(a, id)
    await connect(candidates[7]!, b)
    await connect(me, candidates[0]!, 'pending')
    await connect(candidates[1]!, me, 'pending')
    const suggestions = await friendSuggestions(me)
    expect(suggestions).toHaveLength(6)
    expect(suggestions[0]!.profile.id).toBe(candidates[7])
    expect(suggestions[0]!.mutualFriends.map((p) => p.id).sort()).toEqual([a, b].sort())
    expect(suggestions.map((s) => s.profile.id)).not.toContain(me)
    expect(suggestions.map((s) => s.profile.id)).not.toContain(a)
    expect(suggestions.map((s) => s.profile.id)).not.toContain(b)
    expect(suggestions.map((s) => s.profile.id)).not.toContain(candidates[0])
    expect(suggestions.map((s) => s.profile.id)).not.toContain(candidates[1])
  })

  it('requires accepted edges and filters unavailable or blocked candidates and mutual friends in either direction', async () => {
    const me = await person('viewer')
    const mutual = await person('mutual')
    const hiddenMutual = await person('hidden_mutual')
    await connect(me, mutual)
    await connect(me, hiddenMutual)
    await block(hiddenMutual, me)
    const hiddenPath = await person('hidden_path')
    await connect(hiddenMutual, hiddenPath)
    const pendingPath = await person('pending_path')
    await connect(mutual, pendingPath, 'pending')
    for (const options of [{ blocked: true }, { role: 'pending' as const }, {} , {}]) {
      const id = await person('excluded', options)
      await connect(mutual, id)
      if (!options.blocked && !options.role) await block(id, me)
    }
    const candidate = await person('candidate')
    await connect(mutual, candidate)
    await block(candidate, mutual)
    expect(await friendSuggestions(me)).toEqual([])
    expect((await loadMutualFriends(me, [candidate])).get(candidate)).toBeUndefined()
    await db.delete(userBlocks).where(eq(userBlocks.blockerUserId, candidate))
    expect((await friendSuggestions(me)).map((s) => s.profile.id)).toEqual([candidate])
    await block(me, candidate)
    expect(await friendSuggestions(me)).toEqual([])
  })

  it('handles both edge orientations and returns mutual lists on incoming/outgoing requests and profiles without private fields', async () => {
    const me = await person('viewer')
    const mutual = await person('mutual')
    const incoming = await person('incoming')
    const outgoing = await person('outgoing')
    await connect(mutual, me)
    await connect(incoming, mutual)
    await connect(mutual, outgoing)
    await connect(incoming, me, 'pending')
    await connect(me, outgoing, 'pending')
    auth.userId = me
    const app = Fastify()
    await registerFriendRoutes(app)
    try {
      const list = friendsListSchema.parse((await app.inject('/api/friends')).json())
      expect(list.incoming[0]!.mutualFriends?.map((p) => p.id)).toEqual([mutual])
      expect(list.outgoing[0]!.mutualFriends?.map((p) => p.id)).toEqual([mutual])
      const response = await app.inject(`/api/friends/profiles/${incoming}`)
      expect(response.statusCode).toBe(200)
      const view = friendProfileViewSchema.parse(response.json())
      expect(view.relationship).toBe('incoming')
      expect(view.mutualFriends.map((p) => p.id)).toEqual([mutual])
      expect(Object.keys(response.json().profile).sort()).toEqual(['avatarUrl', 'displayName', 'id', 'profileColor', 'username'])
      await block(incoming, me)
      expect((await app.inject(`/api/friends/profiles/${incoming}`)).statusCode).toBe(404)
      const pending = await person('unapproved', { role: 'pending' })
      expect((await app.inject(`/api/friends/profiles/${pending}`)).statusCode).toBe(404)
    } finally { await app.close() }
  })

  it('returns no suggestions or mutuals for an empty graph', async () => {
    const me = await person('viewer')
    expect(await friendSuggestions(me)).toEqual([])
    expect(await loadMutualFriends(me, [])).toEqual(new Map())
  })
})
