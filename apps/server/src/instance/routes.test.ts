import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../auth/service.js'

const query = vi.hoisted(() => vi.fn())
vi.mock('../database/client.js', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return { db: drizzle(query) }
})
vi.mock('../responses/events.js', () => ({ publishSessionRevocation: vi.fn() }))
vi.mock('../profile/service.js', () => ({ profileAvatarUrl: vi.fn() }))

import { registerInstanceRoutes } from './routes.js'

const now = new Date('2026-09-15T12:00:00.000Z')
let user: AuthenticatedUser | null
let app: FastifyInstance

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now.getTime())
  query.mockReset().mockResolvedValue({ rows: [['3']] })
  user = { id: 'viewer', role: 'user', blocked: false } as AuthenticatedUser
  app = Fastify()
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => { request.user = user })
  await registerInstanceRoutes(app)
})

afterEach(async () => {
  await app.close()
  vi.restoreAllMocks()
})

describe('instance online count', () => {
  it('counts distinct users across sessions with an inclusive 30-minute cutoff', async () => {
    const response = await app.inject('/api/instance/online-count')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ count: 3 })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(query).toHaveBeenCalledWith(
      'select count(distinct "user_id") from "sessions" where "sessions"."last_seen_at" >= $1',
      ['2026-09-15T11:30:00.000Z'],
      'all',
      expect.anything(),
    )
  })

  it('returns zero when no sessions were recently seen', async () => {
    query.mockResolvedValue({ rows: [['0']] })
    expect((await app.inject('/api/instance/online-count')).json()).toEqual({ count: 0 })
  })

  it.each([
    [null, 401],
    [{ id: 'pending', role: 'pending', blocked: false }, 403],
    [{ id: 'blocked', role: 'user', blocked: true }, 403],
  ])('rejects unauthorized viewers before querying (%j)', async (viewer, status) => {
    user = viewer as AuthenticatedUser | null
    expect((await app.inject('/api/instance/online-count')).statusCode).toBe(status)
    expect(query).not.toHaveBeenCalled()
  })
})
