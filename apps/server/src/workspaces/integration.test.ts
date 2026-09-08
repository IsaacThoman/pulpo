import { advanceMessageQueue } from '../chats/message-queue.js'
import { queuedMessages } from '../database/schema.js'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createResponse } from '../responses/service.js'
import { processAgentGeneration } from '../agent/runner.js'
import { getConfig } from '../config.js'
import { encryptSecret } from '../lib/crypto.js'
import { applicationSettings, userPreferences, modelPricingVersions, agentRuns, attachments, requestLogs } from '../database/schema.js'
import { agentLockClient } from '../database/client.js'
const fake = vi.hoisted(() => ({ turn: 0, folder: '', contexts: [] as any[], blobs: new Map<string, Uint8Array>() }))
vi.mock('../responses/post-tasks.js', () => ({ runPostResponseTasks: async () => 0 }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ put: async (key: string, bytes: Uint8Array) => { fake.blobs.set(key, bytes) } }) }))
vi.mock('@earendil-works/pi-ai/api/openai-responses.lazy', () => ({ openAIResponsesApi: () => ({
  streamSimple: (_model: unknown, context: any) => {
    fake.contexts.push(JSON.parse(JSON.stringify(context)))
    const turn = fake.turn++
    const content = turn === 0 ? [{ type: 'toolCall', id: 'loop-abandoned', name: 'write', arguments: { path: `${fake.folder}/abandoned.txt`, content: 'must not be replayed' } }]
      : turn === 1 ? [{ type: 'toolCall', id: 'loop-write', name: 'write', arguments: { path: `${fake.folder}/result.txt`, content: 'Finished on the chosen computer' } }]
      : turn === 2 ? [{ type: 'toolCall', id: 'loop-attach', name: 'attach_file', arguments: { path: `${fake.folder}/result.txt` } }]
      : [{ type: 'text', text: 'Your file is ready.' }]
    const message = { role: 'assistant', content, api: 'openai-responses', provider: 'openai', model: 'test', usage: { input: 12, output: 6, cacheRead: 0, cacheWrite: 0, totalTokens: 18, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: turn < 3 ? 'toolUse' : 'stop', timestamp: Date.now() }
    return Object.assign((async function* () { yield { type: 'done', reason: message.stopReason, message } })(), { result: async () => message })
  },
}) }))
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { Server } from 'socket.io'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { ZodError } from 'zod'
import { db, queryClient } from '../database/client.js'
import { users, sessions, providerConnections, models, chats, responses, workspaceOperations, workspaceComputers } from '../database/schema.js'
import { hashToken } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { authenticateSession } from '../auth/service.js'
import { registerWorkspaceRoutes } from './routes.js'
import { registerWorkspaceGateway } from './gateway.js'
import { RoutedWorkspaceManager, WorkspacePaused } from './backend.js'
import { validateWorkspace } from './service.js'
import { workspaceCanResume } from './resume.js'
import { redis } from '../redis.js'

const enabled = process.env.PULPO_WORKSPACE_TESTS === 'true'
const ownerId = randomUUID(), strangerId = randomUUID(), sessionId = randomUUID(), chatId = randomUUID(), providerId = randomUUID(), responseId = randomUUID(), rootId = randomUUID()
const token = randomUUID() + randomUUID()
const app = Fastify(); const server = createServer(); const gateway = new Server(server, { maxHttpBufferSize: 40_000_000 })
let device: { id: string; token: string }; let socket: Socket
const auth = { authorization: `Bearer ${token}` }
const registration = { name: 'Test Mac', platform: 'darwin', shell: '/bin/bash', stagingPath: '/tmp/pulpo-tests', roots: [{ id: rootId, path: '/tmp' }] }
const selection = () => ({ kind: 'computer' as const, deviceId: device.id, rootId })
async function readResponse() { return (await db.select().from(responses).where(eq(responses.id, responseId)))[0]! }

describe.skipIf(!enabled)('computer workspace transport and recovery with PostgreSQL', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_workspaces_test')) throw new Error('Use the disposable pulpo_workspaces_test database')
    await db.execute(sql`truncate users, provider_connections cascade`)
    for (const id of [ownerId, strangerId]) await db.insert(users).values({ id, role: 'user', name: 'Workspace test', email: `${id}@example.test`, username: id.replaceAll('-', '') })
    await db.insert(sessions).values({ id: sessionId, userId: ownerId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3_600_000), appType: 'desktop' })
    await db.insert(providerConnections).values({ id: providerId, name: 'Test', encryptedApiKey: '' })
    await db.insert(models).values({ id: 'workspace-test', providerConnectionId: providerId, upstreamModelId: 'test', name: 'Test', agentEnabled: true, contextWindow: 128000, maxOutputTokens: 1024 })
    await db.insert(chats).values({ id: chatId, userId: ownerId, modelId: 'workspace-test', title: 'Workspace test' })
    await db.insert(responses).values({ id: responseId, chatId, userId: ownerId, modelId: 'workspace-test', status: 'in_progress', agentMode: true, input: [] })
    await app.register(cookie)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async request => { request.user = await authenticateSession(request) })
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ message: error instanceof Error ? error.message : String(error) }))
    await registerWorkspaceRoutes(app)
    const registered = await app.inject({ method: 'POST', url: '/api/me/computers', headers: auth, payload: registration })
    expect(registered.statusCode).toBe(200); device = registered.json()
    await db.update(responses).set({ workspace: selection() }).where(eq(responses.id, responseId))
    registerWorkspaceGateway(gateway)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    socket = io(`http://127.0.0.1:${(server.address() as AddressInfo).port}/workspaces`, { auth: { token: device.token }, transports: ['websocket'] })
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
  })
  afterAll(async () => {
    socket?.disconnect(); await gateway.close(); await app.close(); await queryClient.end(); await agentLockClient.end(); await redis.quit()
  })
  it('binds registration and working folders to the owning account', async () => {
    expect(await validateWorkspace(ownerId, selection())).toEqual(selection())
    await expect(validateWorkspace(strangerId, selection())).rejects.toThrow('no longer authorized')
    await expect(validateWorkspace(ownerId, { ...selection(), rootId: randomUUID() })).rejects.toThrow('no longer authorized')
    const list = await app.inject({ method: 'GET', url: '/api/me/computers', headers: auth })
    expect(list.json().computers[0].id).toBe(device.id)
    expect(JSON.stringify(list.json())).not.toContain(device.token)
  })
  it('dispatches a persisted operation and reconciles status through the device namespace', async () => {
    const manager = new RoutedWorkspaceManager(responseId, chatId, ownerId, selection(), 0, 900)
    const completion = manager.execute('tool-1', 'bash', { command: 'pwd' })
    let operation: { id: string } | undefined
    await vi.waitFor(async () => {
      const reply = await socket.timeout(1000).emitWithAck('poll') as { operations: Array<{ id: string }> }
      operation = reply.operations[0]; expect(operation).toBeDefined()
    })
    expect(await socket.timeout(1000).emitWithAck('result', { id: operation!.id, status: 'running', output: '', exitCode: null })).toEqual({ ok: true })
    await socket.timeout(1000).emitWithAck('result', { id: operation!.id, status: 'completed', output: '/tmp', exitCode: 0 })
    expect((await completion).output).toBe('/tmp')
    expect((await manager.execute('tool-1', 'bash', { command: 'pwd' })).output).toBe('/tmp')
    expect((await db.select().from(workspaceOperations).where(eq(workspaceOperations.operationId, 'tool-1')))).toHaveLength(1)
  })
  it('pauses for a missing command acknowledgment and supports explicit switch without replay', async () => {
    const manager = new RoutedWorkspaceManager(responseId, chatId, ownerId, selection(), 0, 900)
    const completion = manager.execute('tool-lost', 'bash', { command: 'side-effect' })
    const outcome = expect(completion).rejects.toBeInstanceOf(WorkspacePaused)
    await vi.waitFor(async () => expect((await db.select().from(workspaceOperations).where(eq(workspaceOperations.operationId, 'tool-lost'))).length).toBe(1))
    await socket.timeout(1000).emitWithAck('poll') // Dispatch occurred, but the acknowledgment was lost.
    await db.update(workspaceOperations).set({ createdAt: new Date(Date.now() - 31_000) }).where(eq(workspaceOperations.operationId, 'tool-lost'))
    await outcome
    expect((await readResponse()).workspaceWait?.mayHaveStarted).toBe(true)
    expect(await workspaceCanResume(responseId)).toBe(false)
    const recovery = { generation: 0, action: 'switch', workspace: { kind: 'pulpo' } }
    const rejected = await app.inject({ method: 'POST', url: `/api/responses/${responseId}/workspace-recovery`, headers: auth, payload: recovery })
    expect(rejected.statusCode).toBe(409)
    const accepted = await app.inject({ method: 'POST', url: `/api/responses/${responseId}/workspace-recovery`, headers: auth, payload: { ...recovery, acknowledgeUnknown: true } })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().workspaceGeneration).toBe(1)
    expect(await workspaceCanResume(responseId)).toBe(true)
    const duplicate = await app.inject({ method: 'POST', url: `/api/responses/${responseId}/workspace-recovery`, headers: auth, payload: { ...recovery, acknowledgeUnknown: true } })
    expect(duplicate.statusCode).toBe(409)
    const [old] = await db.select().from(workspaceOperations).where(eq(workspaceOperations.operationId, 'tool-lost'))
    expect(old!.cancelRequested).toBe(true)
    await socket.timeout(1000).emitWithAck('result', { id: old!.id, status: 'completed', output: 'late', exitCode: 0 })
    expect((await readResponse()).workspace).toEqual({ kind: 'pulpo' })
    expect((await readResponse()).output).not.toContain('late')
    expect((await db.select().from(workspaceOperations).where(and(eq(workspaceOperations.responseId, responseId), eq(workspaceOperations.generation, 1))))).toHaveLength(0)
  })
  it('uses operation heartbeats instead of device connectivity and renews waiting deadlines', async () => {
    const id = randomUUID()
    await db.insert(responses).values({ id, chatId, userId: ownerId, modelId: 'workspace-test', status: 'in_progress', agentMode: true, workspace: selection(), input: [] })
    const manager = new RoutedWorkspaceManager(id, chatId, ownerId, selection(), 0, 900)
    const operationId = 'heartbeat-test'
    const completion = manager.execute(operationId, 'bash', { command: 'silent command', timeoutMs: 600000 })
    const outcome = expect(completion).rejects.toBeInstanceOf(WorkspacePaused)
    let opId = ''
    await vi.waitFor(async () => {
      const [op] = await db.select().from(workspaceOperations).where(eq(workspaceOperations.operationId, operationId))
      expect(op).toBeDefined(); opId = op!.id
    })
    await db.update(workspaceOperations).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(workspaceOperations.id, opId))
    await socket.timeout(1000).emitWithAck('result', { id: opId, status: 'running', output: '', exitCode: null })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(manager.paused).toBe(false)
    await db.update(workspaceOperations).set({ lastSeenAt: new Date(Date.now() - 31_000), dispatchedAt: new Date() }).where(eq(workspaceOperations.id, opId))
    await socket.timeout(1000).emitWithAck('poll') // A live socket does not refresh the operation heartbeat.
    await outcome
    const [paused] = await db.select().from(responses).where(eq(responses.id, id))
    const renewed = await app.inject({ method: 'POST', url: `/api/responses/${id}/workspace-recovery`, headers: auth, payload: { generation: 0, action: 'wait' } })
    expect(renewed.statusCode).toBe(200)
    expect(Date.parse(renewed.json().workspaceWait.deadline)).toBeGreaterThanOrEqual(Date.parse(paused!.workspaceWait!.deadline))
    expect(renewed.json().workspaceGeneration).toBe(0)
    const clicks = await Promise.all([0, 1].map(() => app.inject({ method: 'POST', url: `/api/responses/${id}/workspace-recovery`, headers: auth, payload: { generation: 0, action: 'none', acknowledgeUnknown: true } })))
    expect(clicks.map(reply => reply.statusCode).sort()).toEqual([200, 409])
    const [recovered] = await db.select().from(responses).where(eq(responses.id, id))
    expect(recovered!.workspace).toEqual({ kind: 'none' })
    expect(recovered!.workspaceGeneration).toBe(1)
  })
  it('resumes the server agent after switching and exports a native file without replay or double billing', async () => {
    fake.folder = await mkdtemp(path.join(os.tmpdir(), 'pulpo-agent-workspace-'))
    const executorModule = '../../../desktop/src/workspace-executor.ts'
    const { WorkspaceExecutor } = await import(executorModule)
    const native = new WorkspaceExecutor({ journal: path.join(fake.folder, 'journal'), stagingPath: path.join(fake.folder, 'staging'), roots: [{ id: rootId, path: fake.folder }], shell: '/bin/bash', rgPath: 'rg' }, (result: unknown) => socket.emit('result', result))
    let timer: ReturnType<typeof setInterval> | undefined
    try {
      await db.update(users).set({ balanceMicros: 1_000_000 }).where(eq(users.id, ownerId))
      await db.update(providerConnections).set({ encryptedApiKey: encryptSecret('test-only', getConfig().ENCRYPTION_KEY) }).where(eq(providerConnections.id, providerId))
      await db.insert(applicationSettings).values({ key: 'agent', value: { enabled: true, billWorkspaces: true } }).onConflictDoUpdate({ target: applicationSettings.key, set: { value: { enabled: true, billWorkspaces: true } } })
      await db.insert(userPreferences).values({ userId: ownerId, values: { memoryEnabled: false } }).onConflictDoNothing()
      await db.insert(modelPricingVersions).values({ id: randomUUID(), modelId: 'workspace-test', inputPriceMicros: 1_000_000, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 1_000_000 })
      const loopChatId = randomUUID()
      await db.insert(chats).values({ id: loopChatId, userId: ownerId, modelId: 'workspace-test', title: 'Native loop' })
      const response = await createResponse({ ownerUserId: ownerId, chatId: loopChatId, input: { modelId: 'workspace-test', input: 'Create a downloadable file', agentMode: false, workspace: selection(), presetSelections: {}, attachmentIds: [] } })
      const running = processAgentGeneration(response.id, true)
      await vi.waitFor(async () => expect((await db.select().from(workspaceOperations).where(eq(workspaceOperations.operationId, 'loop-abandoned')))).toHaveLength(1), { timeout: 5000 })
      await db.update(workspaceOperations).set({ createdAt: new Date(Date.now() - 31_000) }).where(eq(workspaceOperations.operationId, 'loop-abandoned'))
      await running
      const [paused] = await db.select().from(responses).where(eq(responses.id, response.id))
      const [run] = await db.select().from(agentRuns).where(eq(agentRuns.responseId, response.id))
      expect(paused!.status).toBe('in_progress'); expect(paused!.workspaceWait).toBeTruthy()
      expect((run!.context as { suspended: boolean }).suspended).toBe(true)
      expect(fake.turn).toBe(1)
      expect(run!.activeRuntimeMs).toBeGreaterThan(0)
      const queuedId = randomUUID(), dispatchId = randomUUID()
      await db.insert(queuedMessages).values({ id: queuedId, chatId: loopChatId, userId: ownerId, modelId: 'workspace-test', position: 0, dispatchResponseId: dispatchId, content: 'Later message', workspace: { kind: 'pulpo' }, agentMode: true })
      await advanceMessageQueue(loopChatId)
      expect(await db.select().from(responses).where(eq(responses.id, dispatchId))).toHaveLength(0)
      const recovered = await app.inject({ method: 'POST', url: `/api/responses/${response.id}/workspace-recovery`, headers: auth, payload: { generation: 0, action: 'switch', workspace: selection(), acknowledgeUnknown: true } })
      expect(recovered.statusCode).toBe(200)
      const [queued] = await db.select().from(queuedMessages).where(eq(queuedMessages.id, queuedId))
      expect(queued!.workspace).toEqual({ kind: 'pulpo' }); expect(queued!.status).toBe('pending')
      let polling = false
      timer = setInterval(() => {
        if (polling) return
        polling = true
        void socket.timeout(1000).emitWithAck('poll').then(async reply => {
          for (const id of reply.cancel) await native.cancel(id)
          for (const operation of reply.operations) await native.accept(operation)
          native.heartbeat()
        }).finally(() => { polling = false })
      }, 50)
      await processAgentGeneration(response.id, true)
      const [completed] = await db.select().from(responses).where(eq(responses.id, response.id))
      expect(completed!.status).toBe('completed')
      expect(fake.turn).toBe(4)
      expect(JSON.stringify(fake.contexts[1].messages)).toContain('abandoned')
      await expect(readFile(path.join(fake.folder, 'abandoned.txt'))).rejects.toThrow()
      expect(await readFile(path.join(fake.folder, 'result.txt'), 'utf8')).toBe('Finished on the chosen computer')
      const [file] = await db.select().from(attachments).where(eq(attachments.sourceResponseId, response.id))
      expect(file!.status).toBe('ready'); expect(Buffer.from(fake.blobs.get(file!.objectKey)!).toString()).toBe('Finished on the chosen computer')
      const [log] = await db.select().from(requestLogs).where(eq(requestLogs.responseId, response.id))
      const [user] = await db.select().from(users).where(eq(users.id, ownerId))
      expect(log!.costMicros).toBe(72)
      expect(user!.balanceMicros).toBe(1_000_000 - 72)
      await processAgentGeneration(response.id, true)
      expect(fake.turn).toBe(4)
    } finally { if (timer) clearInterval(timer); native.shutdown(); await rm(fake.folder, { recursive: true, force: true }) }
  }, 20000)
  it('settles accrued model usage when a paused response expires without another model call', async () => {
    fake.turn = 0
    const expiryChatId = randomUUID()
    await db.insert(chats).values({ id: expiryChatId, userId: ownerId, modelId: 'workspace-test', title: 'Expiry test' })
    const response = await createResponse({ ownerUserId: ownerId, chatId: expiryChatId, input: { modelId: 'workspace-test', input: 'Expiry test', agentMode: true, workspace: selection(), presetSelections: {}, attachmentIds: [] } })
    const running = processAgentGeneration(response.id, true)
    await vi.waitFor(async () => expect((await db.select().from(workspaceOperations).where(and(eq(workspaceOperations.responseId, response.id), eq(workspaceOperations.operationId, 'loop-abandoned'))))).toHaveLength(1), { timeout: 5000 })
    await db.update(workspaceOperations).set({ createdAt: new Date(Date.now() - 31_000) }).where(eq(workspaceOperations.responseId, response.id))
    await running
    const [paused] = await db.select().from(responses).where(eq(responses.id, response.id))
    await db.update(responses).set({ workspaceWait: { ...paused!.workspaceWait!, deadline: new Date(Date.now() - 1).toISOString() } }).where(eq(responses.id, response.id))
    await expect(processAgentGeneration(response.id, true)).rejects.toThrow('waiting deadline expired')
    const [expired] = await db.select().from(responses).where(eq(responses.id, response.id))
    const [log] = await db.select().from(requestLogs).where(eq(requestLogs.responseId, response.id))
    expect(expired!.status).toBe('failed')
    expect((expired!.error as { message: string })?.message).toContain('waiting deadline expired')
    expect(fake.turn).toBe(1)
    expect(log!.costMicros).toBe(18)
  }, 10000)
  it('revokes execution authorization when the enabling session ends', async () => {
    await db.delete(sessions).where(eq(sessions.id, sessionId))
    await expect(validateWorkspace(ownerId, selection())).rejects.toThrow()
    const revoked = new Promise<void>(resolve => socket.once('revoked', resolve))
    socket.emit('poll', () => undefined)
    await revoked
    const [retained] = await db.select().from(workspaceComputers).where(eq(workspaceComputers.id, device.id))
    expect(retained!.sessionId).toBeNull()
    expect((await db.select().from(workspaceOperations).where(eq(workspaceOperations.deviceId, device.id))).length).toBeGreaterThan(0)
  })
})
