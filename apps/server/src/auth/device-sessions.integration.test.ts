import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import { eq, sql } from 'drizzle-orm'
import { io as connectSocket, type Socket } from 'socket.io-client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

// The suite uses real PostgreSQL, Redis pub/sub, Socket.IO servers and clients.
// Chat-grant issuance is outside this feature; supply a grant to exercise its actor identity.
vi.mock('../jobs.js', () => ({ generationQueue: {}, maintenanceQueue: {}, embeddingQueue: {} }))
vi.mock('../admin/chat-access.js', () => ({ resolveAdminChatSocketAccess: async (_token: string, actor: { id: string }) => ({ actorUser: actor, ownerUser: { id: 'chat-owner' }, chatId: randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString() }) }))

import { db, queryClient } from '../database/client.js'
import { auditEvents, sessions, users } from '../database/schema.js'
import { redis } from '../redis.js'
import { hashToken } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { authenticateSession, authenticateSessionToken, createNativeSession, createSession } from './service.js'
import { registerDeviceSessionRoutes } from './device-routes.js'
import { createSocketServer } from '../realtime/socket.js'

const enabled = process.env.PULPO_DEVICE_SESSION_TESTS === 'true'
const ownerId = randomUUID(), otherId = randomUUID(), adminId = randomUUID()
const runningApps: FastifyInstance[] = []
const clients: Socket[] = []
async function session(userId: string, patch: Partial<typeof sessions.$inferInsert> = {}) {
  const id = randomUUID(), token = `s${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`
  await db.insert(sessions).values({ id, userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000), ...patch })
  return { id, token }
}
async function app() {
  const instance = Fastify()
  runningApps.push(instance)
  await instance.register(cookie)
  instance.decorateRequest('user', null)
  instance.addHook('onRequest', async (request) => { request.user = await authenticateSession(request) })
  instance.addHook('preHandler', async (request) => {
    // Simulate identities installed by API-key/management/delegation plugins.
    if (request.headers['test-auth-kind'] === 'api-key') request.apiKeyId = randomUUID()
    if (request.headers['test-auth-kind'] === 'management') request.managementTokenId = randomUUID()
    if (request.headers['test-auth-kind'] === 'delegated') request.adminChatAccess = {} as never
  })
  instance.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ message: error instanceof Error ? error.message : 'Unknown error' }))
  await registerDeviceSessionRoutes(instance)
  instance.get('/test-cookie', async (request, reply) => { await createSession(ownerId, request, reply); return { ok: true } })
  instance.get('/test-native', (request) => createNativeSession(ownerId, 'Test Android', request, { appType: 'mobile', platform: 'android' }))
  return instance
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` })

describe.skipIf(!enabled)('device sessions with PostgreSQL and Redis', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.includes('/pulpo_devices_test')) throw new Error('Use a disposable pulpo_devices_test database')
    clients.splice(0).forEach((client) => client.disconnect())
    await Promise.all(runningApps.splice(0).map((instance) => instance.close()))
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local client_min_messages = warning`)
      await tx.execute(sql`truncate users, audit_events cascade`)
    })
    for (const [id, role] of [[ownerId, 'user'], [otherId, 'user'], [adminId, 'admin']] as const) {
      await db.insert(users).values({ id, role, name: 'Device test', email: `${id}@example.test`, username: `u${id.replaceAll('-', '')}` })
    }
  })
  afterAll(async () => {
    clients.forEach((client) => client.disconnect())
    await Promise.all(runningApps.map((instance) => instance.close()))
    await queryClient.end()
    redis.disconnect()
  })
  it('lists only owned unexpired sessions, current first, without secrets', async () => {
    const current = await session(ownerId)
    const older = await session(ownerId, { lastSeenAt: new Date(Date.now() - 60_000) })
    const newer = await session(ownerId, { lastSeenAt: new Date(Date.now() - 1_000) })
    await session(ownerId, { expiresAt: new Date(Date.now() - 1000) })
    await session(otherId)
    const response = await (await app()).inject({ url: '/api/me/sessions', headers: auth(current.token) })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().sessions.map((row: { id: string }) => row.id)).toEqual([current.id, newer.id, older.id])
    expect(response.json().sessions[0].isCurrent).toBe(true)
    expect(response.body).not.toContain('token')
    expect(response.body).not.toContain(hashToken(current.token))
  })
  it('scopes deletion to the owner, supports retries, and records an audit', async () => {
    const current = await session(ownerId), target = await session(ownerId), other = await session(otherId)
    const server = await app()
    expect((await server.inject({ method: 'DELETE', url: `/api/me/sessions/${other.id}`, headers: auth(current.token) })).statusCode).toBe(204)
    expect(await authenticateSessionToken(other.token)).not.toBeNull()
    for (let i = 0; i < 2; i++) expect((await server.inject({ method: 'DELETE', url: `/api/me/sessions/${target.id}`, headers: auth(current.token) })).statusCode).toBe(204)
    expect(await authenticateSessionToken(target.token)).toBeNull()
    const audits = await db.select().from(auditEvents)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actorUserId: ownerId, targetId: ownerId, metadata: { sessionIds: [target.id], count: 1 } })
  })
  it('revokes all others while keeping the initiating session and other users', async () => {
    const current = await session(ownerId), target = await session(ownerId), other = await session(otherId)
    const server = await app()
    expect((await server.inject({ method: 'POST', url: '/api/me/sessions/revoke-others', headers: auth(current.token) })).statusCode).toBe(204)
    expect(await authenticateSessionToken(current.token)).not.toBeNull()
    expect(await authenticateSessionToken(target.token)).toBeNull()
    expect(await authenticateSessionToken(other.token)).not.toBeNull()
  })
  it('clears the current cookie and rejects subsequent credentials', async () => {
    const current = await session(ownerId), server = await app()
    const response = await server.inject({ method: 'DELETE', url: `/api/me/sessions/${current.id}`, cookies: { pulpo_session: current.token } })
    expect(response.statusCode).toBe(204)
    expect(response.headers['set-cookie']).toContain('pulpo_session=;')
    expect((await server.inject({ url: '/api/me/sessions', headers: auth(current.token) })).statusCode).toBe(401)
  })
  it('requires interactive credentials and admin permissions', async () => {
    const current = await session(ownerId), admin = await session(adminId), server = await app()
    expect((await server.inject({ url: '/api/me/sessions' })).statusCode).toBe(401)
    for (const kind of ['api-key', 'management', 'delegated']) {
      expect((await server.inject({ url: '/api/me/sessions', headers: { ...auth(current.token), 'test-auth-kind': kind } })).statusCode).toBe(401)
      expect((await server.inject({ url: `/api/admin/users/${ownerId}/sessions`, headers: { ...auth(admin.token), 'test-auth-kind': kind } })).statusCode).toBe(401)
    }
    expect((await server.inject({ url: `/api/admin/users/${ownerId}/sessions`, headers: auth(current.token) })).statusCode).toBe(403)
    expect((await server.inject({ method: 'POST', url: `/api/admin/users/${ownerId}/sessions/revoke-all`, headers: auth(current.token) })).statusCode).toBe(403)
    expect((await server.inject({ url: `/api/admin/users/${randomUUID()}/sessions`, headers: auth(admin.token) })).statusCode).toBe(404)
    expect((await server.inject({ method: 'DELETE', url: '/api/me/sessions/invalid', headers: auth(current.token) })).statusCode).toBe(400)
  })
  it('lets admins inspect and revoke a target user while preserving other accounts', async () => {
    const current = await session(ownerId), second = await session(ownerId), other = await session(otherId), admin = await session(adminId), server = await app()
    const base = `/api/admin/users/${ownerId}/sessions`
    expect((await server.inject({ url: base, headers: auth(admin.token) })).json().sessions.every((row: { isCurrent: boolean }) => !row.isCurrent)).toBe(true)
    await server.inject({ method: 'DELETE', url: `${base}/${second.id}`, headers: auth(admin.token) })
    expect(await authenticateSessionToken(second.token)).toBeNull()
    await server.inject({ method: 'POST', url: `${base}/revoke-all`, headers: auth(admin.token) })
    expect(await authenticateSessionToken(current.token)).toBeNull()
    expect(await authenticateSessionToken(other.token)).not.toBeNull()
    expect(await authenticateSessionToken(admin.token)).not.toBeNull()
    const audits = await db.select().from(auditEvents)
    expect(audits).toHaveLength(2)
    expect(audits.every((row) => row.actorUserId === adminId && row.targetId === ownerId)).toBe(true)
    const self = await server.inject({ method: 'POST', url: `/api/admin/users/${adminId}/sessions/revoke-all`, headers: auth(admin.token) })
    expect(self.headers['set-cookie']).toContain('pulpo_session=;')
  })
  it('captures sign-in IP and updates latest IP for cookie and native sessions', async () => {
    const server = await app()
    const cookieLogin = await server.inject({ url: '/test-cookie', headers: { 'cf-connecting-ip': '198.51.100.1' } })
    const cookieToken = cookieLogin.cookies[0]!.value
    const nativeLogin = await server.inject({ url: '/test-native', headers: { 'cf-connecting-ip': '198.51.100.2' } })
    const nativeToken = nativeLogin.json().token as string
    for (const [token, ip] of [[cookieToken, '198.51.100.1'], [nativeToken, '198.51.100.2']]) {
      const response = await server.inject({ url: '/api/me/sessions', headers: { ...auth(token!), 'cf-connecting-ip': '2001:db8::3' } })
      expect(response.json().sessions[0]).toMatchObject({ signInIp: ip, latestIp: '2001:db8::3', isCurrent: true })
    }
    const rows = await db.select().from(sessions)
    expect(rows.find((row) => row.tokenHash === hashToken(nativeToken))).toMatchObject({ appType: 'mobile', platform: 'android' })
    expect(rows.find((row) => row.tokenHash === hashToken(cookieToken))).toMatchObject({ appType: 'web' })
  })
  it('disconnects revoked sessions across two servers, including delegated admin sockets', async () => {
    const keep = await session(adminId), revoked = await session(adminId), unrelated = await session(otherId)
    const servers = await Promise.all([app(), app()])
    const sockets = await Promise.all(servers.map((server) => createSocketServer(server.server)))
    for (const server of servers) await server.listen({ host: '127.0.0.1', port: 0 })
    async function client(index: number, token: string, delegated = false) {
      const address = servers[index]!.server.address() as AddressInfo
      const socket = connectSocket(`http://127.0.0.1:${address.port}`, {
        path: '/socket.io', transports: ['websocket'], reconnectionDelay: 10,
        auth: { sessionToken: token, ...(delegated ? { adminChatAccessToken: 'test-grant' } : {}) },
        extraHeaders: { 'cf-connecting-ip': '198.51.100.99' }, autoConnect: false,
      })
      clients.push(socket)
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect() })
      return socket
    }
    const preserved = await client(0, keep.token), victim = await client(0, revoked.token), delegated = await client(1, revoked.token, true), other = await client(1, unrelated.token)
    const victimError = vi.fn(), delegatedError = vi.fn(), reconnect = vi.fn(), otherDisconnect = vi.fn()
    victim.on('connect_error', victimError); delegated.on('connect_error', delegatedError)
    preserved.on('connect', reconnect); other.on('disconnect', otherDisconnect)
    const [updated] = await db.select().from(sessions).where(eq(sessions.id, revoked.id))
    expect(updated?.latestIpAddress).toBe('198.51.100.99')
    await servers[0]!.inject({ method: 'DELETE', url: `/api/me/sessions/${revoked.id}`, headers: auth(keep.token) })
    await vi.waitFor(() => {
      expect(victimError).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }))
      expect(delegatedError).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }))
      expect(reconnect).toHaveBeenCalled()
    }, { timeout: 5000 })
    expect(preserved.connected).toBe(true)
    expect(other.connected).toBe(true)
    expect(otherDisconnect).not.toHaveBeenCalled()
    expect((await servers[1]!.inject({ url: '/api/me/sessions', headers: auth(revoked.token) })).statusCode).toBe(401)
    clients.forEach((connection) => connection.disconnect())
    await Promise.all(sockets.map((socket) => new Promise<void>((resolve) => socket.close(() => resolve()))))
  }, 15_000)
})
