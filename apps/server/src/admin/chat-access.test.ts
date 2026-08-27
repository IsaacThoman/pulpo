import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  currentUser: null as Record<string, unknown> | null,
  selectResults: [] as unknown[][],
  auditRows: [] as Array<Record<string, unknown>>,
  grants: new Map<string, string>(),
  redisTtl: 0,
  hasTwoFactor: vi.fn(),
  verifySecondFactor: vi.fn(),
}))

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        innerJoin: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => mocks.selectResults.shift() ?? []),
      }
      return builder
    }),
    insert: vi.fn(() => ({
      values: vi.fn(async (row: Record<string, unknown>) => { mocks.auditRows.push(row) }),
    })),
  },
}))

vi.mock('../redis.js', () => ({
  redis: {
    get: vi.fn(async (key: string) => mocks.grants.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, _mode: string, ttl: number) => {
      mocks.grants.set(key, value)
      mocks.redisTtl = ttl
      return 'OK'
    }),
    del: vi.fn(async (key: string) => mocks.grants.delete(key) ? 1 : 0),
  },
}))

vi.mock('../auth/two-factor.js', () => ({
  hasTwoFactor: mocks.hasTwoFactor,
  verifySecondFactor: mocks.verifySecondFactor,
}))

vi.mock('../auth/service.js', () => ({
  requireUser: (request: { user: Record<string, unknown> | null }) => {
    if (!request.user) throw Object.assign(new Error('Unauthorized'), { statusCode: 401, code: 'unauthorized' })
    if (request.user.blocked) throw Object.assign(new Error('Blocked'), { statusCode: 403, code: 'forbidden' })
    return request.user
  },
  serializeUser: (user: Record<string, unknown>) => user,
}))

import { registerAdminChatAccess } from './chat-access.js'

const chatId = '9db9ea5a-3af7-4b66-9f2a-c179278a0998'
const otherChatId = 'e22ec128-10cd-4598-97c7-7617cd421c3a'
const admin = { id: 'd937719f-909c-45d7-98a9-192077b9b6a8', role: 'admin', blocked: false, name: 'Admin', email: 'admin@example.com' }
const owner = { id: '5353ba33-c0f6-46f0-9f76-97d2c10762f6', role: 'user', blocked: true, name: 'Owner', email: 'owner@example.com' }
const chat = { id: chatId, title: 'Private chat', temporary: false, deletedAt: null, expiresAt: null }

async function app() {
  const instance = Fastify()
  instance.decorateRequest('user', null)
  instance.decorateRequest('adminChatAccess', null)
  instance.addHook('preValidation', async (request) => { request.user = mocks.currentUser as never })
  await registerAdminChatAccess(instance)
  instance.get('/api/chats/:id/probe', async (request) => ({
    userId: request.user?.id,
    actorId: request.adminChatAccess?.actorUser.id,
    chatId: request.adminChatAccess?.chatId,
  }))
  return instance
}

async function createGrant(instance: Awaited<ReturnType<typeof app>>): Promise<string> {
  mocks.selectResults.push([{ chat, owner }])
  const response = await instance.inject({
    method: 'POST',
    url: `/api/admin/chats/${chatId}/access`,
    payload: { reason: 'Investigating a customer support request', verificationCode: '123456' },
  })
  expect(response.statusCode).toBe(201)
  return response.json().accessToken as string
}

beforeEach(() => {
  mocks.currentUser = admin
  mocks.selectResults = []
  mocks.auditRows = []
  mocks.grants.clear()
  mocks.redisTtl = 0
  mocks.hasTwoFactor.mockReset().mockResolvedValue(true)
  mocks.verifySecondFactor.mockReset().mockResolvedValue('totp')
})

describe('scoped administrator chat access', () => {
  it('rejects non-admins, missing reasons, accounts without 2FA, and invalid codes', async () => {
    const instance = await app()
    mocks.currentUser = owner
    expect((await instance.inject({ method: 'POST', url: `/api/admin/chats/${chatId}/access`, payload: { reason: 'A sufficiently long reason', verificationCode: '123456' } })).statusCode).toBe(403)

    mocks.currentUser = admin
    expect((await instance.inject({ method: 'POST', url: `/api/admin/chats/${chatId}/access`, payload: { reason: 'short', verificationCode: '123456' } })).statusCode).toBe(400)

    mocks.hasTwoFactor.mockResolvedValue(false)
    expect((await instance.inject({ method: 'POST', url: `/api/admin/chats/${chatId}/access`, payload: { reason: 'A sufficiently long reason', verificationCode: '123456' } })).statusCode).toBe(403)

    mocks.hasTwoFactor.mockResolvedValue(true)
    mocks.verifySecondFactor.mockRejectedValue(Object.assign(new Error('Invalid'), { statusCode: 401, code: 'two_factor_code_invalid' }))
    expect((await instance.inject({ method: 'POST', url: `/api/admin/chats/${chatId}/access`, payload: { reason: 'A sufficiently long reason', verificationCode: '123456' } })).statusCode).toBe(401)

    expect(JSON.stringify(mocks.auditRows)).not.toContain('123456')
    await instance.close()
  })

  it('stores a hashed, 30-minute grant and resolves owner and actor separately', async () => {
    const instance = await app()
    const token = await createGrant(instance)

    expect(mocks.redisTtl).toBe(30 * 60)
    expect([...mocks.grants.keys()].some((key) => key.includes(token))).toBe(false)
    expect([...mocks.grants.values()].some((value) => value.includes(token))).toBe(false)

    mocks.selectResults.push([owner], [{ id: chatId }])
    const response = await instance.inject({
      method: 'GET', url: `/api/chats/${chatId}/probe`, headers: { 'x-pulpo-admin-chat-access': token },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ userId: owner.id, actorId: admin.id, chatId })
    await instance.close()
  })

  it('rejects cross-chat IDs and revoked or expired grants', async () => {
    const instance = await app()
    const token = await createGrant(instance)

    mocks.selectResults.push([owner], [{ id: chatId }])
    expect((await instance.inject({
      method: 'GET', url: `/api/chats/${otherChatId}/probe`, headers: { 'x-pulpo-admin-chat-access': token },
    })).statusCode).toBe(403)

    const revoked = await instance.inject({
      method: 'DELETE', url: `/api/admin/chats/${chatId}/access`, headers: { 'x-pulpo-admin-chat-access': token },
    })
    expect(revoked.statusCode).toBe(204)
    expect((await instance.inject({
      method: 'GET', url: `/api/chats/${chatId}/probe`, headers: { 'x-pulpo-admin-chat-access': token },
    })).statusCode).toBe(403)

    const expiringToken = await createGrant(instance)
    const [key, value] = [...mocks.grants.entries()].find(([, stored]) => stored.includes(chatId))!
    mocks.grants.set(key, JSON.stringify({ ...JSON.parse(value), expiresAt: new Date(Date.now() - 1_000).toISOString() }))
    expect((await instance.inject({
      method: 'GET', url: `/api/chats/${chatId}/probe`, headers: { 'x-pulpo-admin-chat-access': expiringToken },
    })).statusCode).toBe(403)
    await instance.close()
  })
})
