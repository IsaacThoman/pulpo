import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { ZodError } from 'zod'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FriendsList } from '@pulpo/contracts'
import type { AuthenticatedUser } from '../auth/service.js'
import { db, queryClient } from '../database/client.js'
import { friendSuggestionDismissals, friendships, users } from '../database/schema.js'
import { orderedPair, registerFriendRoutes } from './routes.js'

const publish = vi.hoisted(() => vi.fn())
vi.mock('../responses/events.js', () => ({ publishStateChange: publish }))
const enabled = process.env.PULPO_FRIENDS_TESTS === 'true'

describe.skipIf(!enabled)('friend suggestion dismissals', () => {
  let app: FastifyInstance
  let actor: AuthenticatedUser | undefined
  let viewer: AuthenticatedUser
  let friend: AuthenticatedUser
  let suggested: AuthenticatedUser

  const createUser = async (): Promise<AuthenticatedUser> => {
    const id = randomUUID()
    const [row] = await db.insert(users).values({ id, name: `Friend ${id.slice(0, 8)}`, email: `${id}@example.test`, username: `f${id.replaceAll('-', '')}`, role: 'user' }).returning()
    return row as unknown as AuthenticatedUser
  }
  const befriend = async (left: string, right: string) => {
    const [userAId, userBId] = orderedPair(left, right)
    await db.insert(friendships).values({ id: randomUUID(), userAId, userBId, requestedByUserId: left, status: 'accepted', acceptedAt: new Date() })
  }
  const suggestionIds = async () => {
    const response = await app.inject({ method: 'GET', url: '/api/friends' })
    expect(response.statusCode).toBe(200)
    return (response.json() as FriendsList).suggestions?.map((suggestion) => suggestion.profile.id) ?? []
  }
  const dismiss = (userId: string) => app.inject({ method: 'POST', url: '/api/friends/suggestions/dismissals', payload: { userId } })

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_friends_test')) throw new Error('Use the disposable pulpo_friends_test database')
    app = Fastify()
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (request) => { (request as { user?: AuthenticatedUser }).user = actor })
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) return reply.code(400).send({ code: 'invalid_request' })
      const status = (error as { statusCode?: number }).statusCode ?? 500
      return reply.code(status).send({ code: (error as { code?: string }).code })
    })
    await registerFriendRoutes(app)
  })

  beforeEach(async () => {
    viewer = await createUser()
    friend = await createUser()
    suggested = await createUser()
    await befriend(viewer.id, friend.id)
    await befriend(friend.id, suggested.id)
    actor = viewer
    publish.mockClear()
  })

  afterAll(async () => {
    await app?.close()
    await queryClient.end()
  })

  it('stops suggesting a dismissed person and refreshes only the viewer', async () => {
    expect(await suggestionIds()).toEqual([suggested.id])

    const response = await dismiss(suggested.id)
    expect(response.statusCode).toBe(204)
    expect(await suggestionIds()).toEqual([])
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ userId: viewer.id, scopes: ['friends'] }))

    // Dismissing again is harmless.
    expect((await dismiss(suggested.id)).statusCode).toBe(204)
    const rows = await db.select().from(friendSuggestionDismissals).where(eq(friendSuggestionDismissals.userId, viewer.id))
    expect(rows).toEqual([expect.objectContaining({ dismissedUserId: suggested.id, mutualFriendCount: 1 })])
  })

  it('suggests them again once they share more friends, and a new dismissal resets that', async () => {
    await dismiss(suggested.id)

    const second = await createUser()
    await befriend(viewer.id, second.id)
    expect(await suggestionIds()).toEqual([])
    await befriend(second.id, suggested.id)
    expect(await suggestionIds()).toEqual([suggested.id])

    await dismiss(suggested.id)
    expect(await suggestionIds()).toEqual([])
    const [row] = await db.select().from(friendSuggestionDismissals).where(eq(friendSuggestionDismissals.userId, viewer.id))
    expect(row?.mutualFriendCount).toBe(2)
  })

  it('does not count mutual friends the viewer has blocked toward the baseline', async () => {
    const blocked = await createUser()
    await befriend(viewer.id, blocked.id)
    await befriend(blocked.id, suggested.id)
    await app.inject({ method: 'POST', url: '/api/friends/blocks', payload: { userId: blocked.id } })

    await dismiss(suggested.id)
    const [row] = await db.select().from(friendSuggestionDismissals).where(eq(friendSuggestionDismissals.userId, viewer.id))
    expect(row?.mutualFriendCount).toBe(1)
    expect(await suggestionIds()).toEqual([])
  })

  it('is one-sided and leaves friend requests working', async () => {
    await dismiss(suggested.id)

    // The dismissed person still sees the viewer as a suggestion.
    actor = suggested
    expect(await suggestionIds()).toEqual([viewer.id])

    actor = viewer
    const request = await app.inject({ method: 'POST', url: '/api/friends/requests', payload: { userId: suggested.id } })
    expect(request.statusCode).toBe(201)
  })

  it('rejects dismissing yourself or someone who does not exist', async () => {
    expect((await dismiss(viewer.id)).json()).toEqual({ code: 'cannot_dismiss_self' })
    expect((await dismiss(randomUUID())).statusCode).toBe(404)
    expect((await dismiss('not-a-uuid')).statusCode).toBe(400)
  })

  it('forgets dismissals when either account is deleted', async () => {
    await dismiss(suggested.id)
    await db.delete(users).where(eq(users.id, suggested.id))
    const rows = await db.select().from(friendSuggestionDismissals).where(eq(friendSuggestionDismissals.userId, viewer.id))
    expect(rows).toEqual([])
  })
})
