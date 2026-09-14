import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Server } from 'socket.io'
import { io, type Socket } from 'socket.io-client'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { computerActionPayload, type ComputerAnnounce } from '@pulpo/contracts'

vi.mock('../../jobs.js', () => ({ generationQueue: {}, maintenanceQueue: {}, embeddingQueue: {} }))
import { db, queryClient } from '../../database/client.js'
import { users, sessions, chats, models, providerConnections, responses, agentRuns, agentComputers } from '../../database/schema.js'
import { createRedis, redis } from '../../redis.js'
import { hashToken } from '../../lib/crypto.js'
import { registerComputerNamespace } from '../../realtime/computer-namespace.js'
import { assertComputerUsable, authorizeComputerRequest, registerComputer, revokeComputer } from './registry.js'
import { requestPairing, revokePairing } from './pairings.js'
import { consumePairingCode, issuePairingCode } from './pairing-codes.js'
import { createToolApproval, decideToolApproval, verifyToolApproval } from './approvals.js'
import { clearComputerPresence, computerPresenceKey, markComputerOnline, readPresence, refreshComputerPresence } from './presence.js'
import { ComputerRpcClient } from './rpc.js'

const enabled = process.env.PULPO_COMPUTER_SECURITY_TESTS === 'true'
const userId = randomUUID(), desktopSession = randomUUID(), remoteSession = randomUUID(), computerId = randomUUID()
const token = randomBytes(32).toString('hex'), secret = randomBytes(32).toString('hex')
const providerId = randomUUID(), modelId = `computer-test-${randomUUID()}`, chatId = randomUUID(), responseId = randomUUID(), runId = randomUUID()
const announce: ComputerAnnounce = { computerId, name: 'Studio', os: 'macos', arch: 'arm64', appVersion: 'test', accessMode: 'folder', rootPath: '/project', attachmentsDir: '/app/chats', homeDir: '/home/test', shell: 'bash', approvalPolicy: 'default', allowRemote: true }
const servers: Server[] = [], clients: Socket[] = [], subscribers: ReturnType<typeof createRedis>[] = []

async function replica() {
  const http = createServer(), server = new Server(http)
  const subscriber = createRedis()
  servers.push(server); subscribers.push(subscriber)
  registerComputerNamespace(server, subscriber)
  http.listen(0, '127.0.0.1'); await once(http, 'listening')
  await vi.waitFor(async () => expect(await redis.pubsub('NUMSUB', 'pulpo:computer-requests')).toContain(subscribers.length))
  return `http://127.0.0.1:${(http.address() as { port: number }).port}/computer`
}
async function connect(url: string, deviceSecret = secret) {
  const socket = io(url, { transports: ['websocket'], auth: { sessionToken: token, deviceSecret, computer: announce }, reconnection: false })
  clients.push(socket)
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
  await vi.waitFor(async () => expect((await readPresence(computerId))?.socketId).toBe(socket.id))
  return socket
}

describe.skipIf(!enabled)('computer security with real database, Redis and sockets', () => {
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_computers_test') throw new Error('Use a disposable pulpo_computers_test database')
    await db.insert(users).values({ id: userId, role: 'user', name: 'Computer test', username: `u${userId.replaceAll('-', '')}`, email: `${userId}@example.test` })
    await db.insert(sessions).values([{ id: desktopSession, userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600_000) }, { id: remoteSession, userId, tokenHash: hashToken(randomUUID()), expiresAt: new Date(Date.now() + 600_000) }])
    await db.insert(providerConnections).values({ id: providerId, name: 'Test', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: modelId, providerConnectionId: providerId, upstreamModelId: 'test', name: 'Test', contextWindow: 10000, maxOutputTokens: 1000 })
    await db.insert(chats).values({ id: chatId, userId, modelId, title: 'Test' })
    await registerComputer(userId, desktopSession, announce, secret)
    await db.insert(responses).values({ id: responseId, chatId, userId, modelId, input: [], status: 'in_progress', workspaceComputerId: computerId, requesterSessionId: remoteSession })
    await db.insert(agentRuns).values({ id: runId, responseId })
  })
  afterAll(async () => {
    clients.forEach((client) => client.disconnect())
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
    subscribers.forEach((subscriber) => subscriber.disconnect())
    if (enabled) { await db.delete(users).where(eq(users.id, userId)); await db.delete(models).where(eq(models.id, modelId)); await db.delete(providerConnections).where(eq(providerConnections.id, providerId)) }
    await queryClient.end(); redis.disconnect()
  })

  it('rejects another session claiming a known computer without the installation credential', async () => {
    await expect(registerComputer(userId, remoteSession, announce, randomBytes(32).toString('hex'))).rejects.toMatchObject({ code: 'computer_credential_invalid' })
    expect((await db.select().from(agentComputers).where(eq(agentComputers.id, computerId)))[0]?.ownerSessionId).toBe(desktopSession)
    const legacyId = randomUUID()
    const [original] = await db.select().from(agentComputers).where(eq(agentComputers.id, computerId))
    await db.insert(agentComputers).values({ ...original!, id: legacyId, credentialHash: null })
    await expect(registerComputer(userId, remoteSession, { ...announce, computerId: legacyId }, secret)).rejects.toMatchObject({ code: 'computer_credential_invalid' })
    expect((await registerComputer(userId, desktopSession, { ...announce, computerId: legacyId }, secret)).credentialHash).toBeTruthy()
    const url = await replica()
    await expect(connect(url, randomBytes(32).toString('hex'))).rejects.toThrow('computer_credential_invalid')
  })

  it('pairs with a one-use code, rejects guesses, expired codes, and brute-force attempts', async () => {
    await markComputerOnline(computerId, 'fixture')
    const raceId = randomUUID()
    const raceCode = await issuePairingCode(raceId)
    expect(await redis.ttl(`pulpo:computer:${raceId}:pairing-code`)).toBeGreaterThan(290)
    const redemptions = await Promise.allSettled([consumePairingCode(raceId, userId, raceCode.code), consumePairingCode(raceId, userId, raceCode.code)])
    expect(redemptions.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const first = await issuePairingCode(computerId)
    expect(first.code).toMatch(/^[A-Z2-9]{6}$/)
    await expect(requestPairing(userId, remoteSession, computerId, null, 'ZZZZZZ')).rejects.toMatchObject({ code: 'pairing_code_invalid' })
    const { id } = await requestPairing(userId, remoteSession, computerId, null, first.code.toLowerCase())
    expect(await assertComputerUsable(userId, remoteSession, computerId)).toMatchObject({ id: computerId })
    await expect(consumePairingCode(computerId, userId, first.code)).rejects.toMatchObject({ code: 'pairing_code_invalid' })
    const second = await issuePairingCode(computerId)
    await redis.del(`pulpo:computer:${computerId}:pairing-code`)
    await expect(consumePairingCode(computerId, userId, second.code)).rejects.toMatchObject({ code: 'pairing_code_invalid' })
    for (let i = 0; i < 10; i++) await consumePairingCode(computerId, userId, 'AAAAAA').catch(() => undefined)
    await expect(consumePairingCode(computerId, userId, 'AAAAAA')).rejects.toMatchObject({ code: 'pairing_rate_limited' })
    await authorizeComputerRequest(computerId, { chatId, responseId, requesterSessionId: remoteSession })
    await revokePairing(userId, desktopSession, id)
    await expect(authorizeComputerRequest(computerId, { chatId, responseId, requesterSessionId: remoteSession })).rejects.toMatchObject({ code: 'computer_pairing_required' })
    expect(await redis.exists(`pulpo:response:${responseId}:cancel`)).toBe(1)
  })

  it('binds approved retries to their action and persists the decision independently of desktop events', async () => {
    const input = { responseId, chatId, agentRunId: runId, computerId, computerName: 'Studio', operationId: randomUUID(), kind: 'write' as const, summary: 'notes.txt', args: { path: 'notes.txt', content: 'original' }, context: { computerId, root: '/project', accessMode: 'folder' } }
    const approval = await createToolApproval(input)
    await decideToolApproval({ approvalId: approval.id, approved: true, userId, sessionId: desktopSession, via: 'chat' })
    const digest = createHash('sha256').update(computerActionPayload(chatId, input.operationId, input.kind, input.args, input.context)).digest('hex')
    expect(await verifyToolApproval(computerId, { approvalId: approval.id, chatId, operationId: input.operationId, digest })).toBe(true)
    expect((await createToolApproval(input)).status).toBe('approved')
    await expect(createToolApproval({ ...input, args: { ...input.args, content: 'changed' } })).rejects.toThrow('changed the action')
    expect(await verifyToolApproval(computerId, { approvalId: approval.id, chatId: randomUUID(), operationId: input.operationId, digest })).toBe(false)
  })

  it('relays each request to one socket across two API replicas and fences stale heartbeats and disconnects', async () => {
    await db.update(responses).set({ requesterSessionId: desktopSession }).where(eq(responses.id, responseId))
    const first = await connect(await replica())
    const second = await connect(await replica())
    const firstRequests = vi.fn((_request, ack) => ack({ ok: true, result: null }))
    const secondRequests = vi.fn((_request, ack) => ack({ ok: true, result: null }))
    first.on('computer.request', firstRequests); second.on('computer.request', secondRequests)
    expect(await refreshComputerPresence(computerId, first.id!)).toBe(false)
    await clearComputerPresence(computerId, first.id!)
    expect((await readPresence(computerId))?.socketId).toBe(second.id)
    const rpc = new ComputerRpcClient()
    await rpc.request(computerId, { chatId, responseId, requesterSessionId: desktopSession, kind: 'operation.status', id: 'test' }, { timeoutMs: 3000 })
    expect(firstRequests).not.toHaveBeenCalled(); expect(secondRequests).toHaveBeenCalledTimes(1)
    const code = await second.timeout(3000).emitWithAck('computer.pairing.code')
    expect(code.code).toMatch(/^[A-Z2-9]{6}$/)
    await rpc.close()
  })

  it('keeps removed identities revoked while allowing a fresh installation identity', async () => {
    await revokeComputer(userId, desktopSession, computerId)
    await expect(registerComputer(userId, desktopSession, announce, secret)).rejects.toMatchObject({ code: 'computer_revoked' })
    const fresh = await registerComputer(userId, desktopSession, { ...announce, computerId: randomUUID() }, randomBytes(32).toString('hex'))
    expect(fresh.id).not.toBe(computerId)
    await redis.del(computerPresenceKey(computerId))
  })
})
