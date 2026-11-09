import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  executed: [] as unknown[],
  friendPeerIds: vi.fn(),
  poolPeerIds: vi.fn(),
  bumpAccountRevisions: vi.fn(),
  publishScopedStateChanges: vi.fn(),
  publishStateChange: vi.fn(),
}))

vi.mock('../database/client.js', () => ({
  db: {
    transaction: async (callback: (tx: unknown) => unknown) => callback({
      execute: async (query: unknown) => { mocks.executed.push(query) },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          mocks.updates.push(values)
          return { where: () => ({ returning: async () => [{ id: 'me', ...values, stateRevision: 8 }] }) }
        },
      }),
    }),
  },
}))
vi.mock('../friends/sync.js', () => ({
  friendPeerIds: mocks.friendPeerIds,
  bumpAccountRevisions: mocks.bumpAccountRevisions,
  publishScopedStateChanges: mocks.publishScopedStateChanges,
}))
vi.mock('../pools/service.js', () => ({ poolPeerIds: mocks.poolPeerIds }))
vi.mock('../responses/events.js', () => ({ publishStateChange: mocks.publishStateChange }))
vi.mock('./service.js', () => ({
  bearerSessionToken: vi.fn(),
  createPasswordHash: vi.fn(),
  createSession: vi.fn(),
  destroySession: vi.fn(),
  requireUser: (request: FastifyRequest) => request.user,
  revokeOtherSessions: vi.fn(),
  serializeUser: (row: unknown) => row,
  verifyPassword: vi.fn(),
}))

import { registerAuthRoutes } from './routes.js'

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>

async function patchProfile(body: unknown, usageVisibility = 'friends') {
  let handler: Handler | undefined
  const app = {
    get: vi.fn(), post: vi.fn(), delete: vi.fn(),
    patch: (url: string, ...args: unknown[]) => {
      if (url === '/api/me') handler = args.at(-1) as Handler
    },
  } as unknown as FastifyInstance
  await registerAuthRoutes(app)
  const request = { user: { id: 'me', usageVisibility }, body } as unknown as FastifyRequest
  return handler!(request, {} as FastifyReply)
}

describe('PATCH /api/me usage visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updates.length = 0
    mocks.executed.length = 0
    mocks.friendPeerIds.mockResolvedValue(['friend'])
    mocks.poolPeerIds.mockResolvedValue(['pool-peer', 'friend'])
    mocks.bumpAccountRevisions.mockImplementation(async (_tx: unknown, ids: string[]) => ids.map((userId) => ({ userId, revision: 1 })))
  })

  it('stores the new visibility and refreshes friends and Pool members', async () => {
    const result = await patchProfile({ usageVisibility: 'public' })
    // The management-settings lock comes first so a stale management apply can't undo this write.
    expect(mocks.executed).toHaveLength(1)
    expect(JSON.stringify(mocks.executed[0])).toContain('pg_advisory_xact_lock(1886747744)')
    expect(mocks.updates[0]).toMatchObject({ usageVisibility: 'public' })
    expect(result).toMatchObject({ user: { usageVisibility: 'public' } })
    expect(mocks.poolPeerIds).toHaveBeenCalledWith(expect.anything(), 'me')
    expect(mocks.publishStateChange).toHaveBeenCalledWith({ userId: 'me', revision: 8 })
    expect(mocks.publishScopedStateChanges).toHaveBeenCalledWith([{ userId: 'friend', revision: 1 }], ['friends'])
    expect(mocks.publishScopedStateChanges).toHaveBeenCalledWith(
      [{ userId: 'pool-peer', revision: 1 }, { userId: 'friend', revision: 1 }],
      ['pool'],
    )
  })

  it('leaves Pool members alone when visibility is unchanged or not part of the patch', async () => {
    await patchProfile({ usageVisibility: 'friends' })
    await patchProfile({ name: 'New Name' })
    expect(mocks.updates[1]).not.toHaveProperty('usageVisibility')
    expect(mocks.poolPeerIds).not.toHaveBeenCalled()
    expect(mocks.publishScopedStateChanges).toHaveBeenCalledWith([], ['pool'])
    expect(mocks.publishScopedStateChanges).not.toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]), ['pool'])
  })

  it('rejects unknown visibility levels before writing', async () => {
    await expect(patchProfile({ usageVisibility: 'everyone' })).rejects.toBeInstanceOf(ZodError)
    await expect(patchProfile({ usageVisibility: null })).rejects.toBeInstanceOf(ZodError)
    expect(mocks.updates).toHaveLength(0)
  })
})
