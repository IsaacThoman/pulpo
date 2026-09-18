import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ userId: '', queue: vi.fn(), cancel: vi.fn(), controller: vi.fn(), leaseCount: 0 }))
vi.mock('../jobs.js', () => ({ generationQueue: { add: mocks.queue }, maintenanceQueue: { add: vi.fn() } }))
vi.mock('../accounting/service.js', () => ({ getActivePricing: vi.fn(async () => ({})), reserveBudget: vi.fn(), releaseBudget: vi.fn() }))
vi.mock('../admin/usage-events.js', () => ({ publishAdminUsage: vi.fn() }))
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn(), requestCancellation: mocks.cancel }))
vi.mock('../episodic-memory/queue.js', () => ({ scheduleChatIndex: vi.fn() }))
vi.mock('../agent/controller-http.js', () => ({ workspaceControllerRequest: mocks.controller }))
vi.mock('../auth/service.js', () => ({ requireUser: () => ({ id: mocks.userId }), billingUserForRequest: () => ({ id: mocks.userId }) }))

import { db, queryClient } from '../database/client.js'
import { agentRuns, attachments, chats, models, providerConnections, responses, users, workspaceLeases } from '../database/schema.js'
import { createResponse } from '../responses/service.js'
import { registerMessageRoutes } from '../messages/routes.js'
import { registerChatRoutes } from '../chats/routes.js'
import { WorkspaceManager, releaseWorkspaceForChat } from './controller.js'
import { getConfig } from '../config.js'
import { reserveBudget } from '../accounting/service.js'

const enabled = process.env.PULPO_WORKSPACE_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_workspace_test') throw new Error('Use the disposable pulpo_workspace_test database')
const providerId = randomUUID(), modelId = `workspace-test-${randomUUID()}`
let chatId: string, app: FastifyInstance
const config = getConfig()
const originalUrl = config.WORKSPACE_CONTROLLER_URL, originalToken = config.WORKSPACE_CONTROLLER_TOKEN

async function send(overrides: Partial<Parameters<typeof createResponse>[0]> = {}) {
  return createResponse({ ownerUserId: mocks.userId, chatId, input: { modelId, input: 'hello', presetSelections: {}, attachmentIds: [], agentMode: false }, ...overrides })
}
async function finish(id: string) { await db.update(responses).set({ status: 'completed' }).where(eq(responses.id, id)) }
async function chat() { return (await db.select().from(chats).where(eq(chats.id, chatId)))[0]! }
async function readyLease(response: typeof responses.$inferSelect, extra: Partial<typeof workspaceLeases.$inferInsert> = {}) {
  const [lease] = await db.insert(workspaceLeases).values({
    id: randomUUID(), chatId, userId: mocks.userId, responseId: response.id, workspaceScopeId: response.workspaceScopeId,
    imageDigest: 'test', controllerLeaseId: randomUUID(), status: 'ready', ...extra,
  }).returning()
  return lease!
}

describe.skipIf(!enabled)('workspace history isolation with PostgreSQL', () => {
  beforeAll(async () => {
    mocks.userId = randomUUID()
    config.WORKSPACE_CONTROLLER_URL = 'http://workspace-controller.test'
    config.WORKSPACE_CONTROLLER_TOKEN = 'workspace-fixture-token-000000000000'
    await db.insert(users).values({ id: mocks.userId, email: `${mocks.userId}@example.test`, username: mocks.userId, name: 'Workspace test' })
    await db.insert(providerConnections).values({ id: providerId, name: 'Workspace test', baseUrl: 'https://example.test', encryptedApiKey: 'test' })
    await db.insert(models).values({ id: modelId, providerConnectionId: providerId, upstreamModelId: 'test', name: 'Workspace test', contextWindow: 32000, maxOutputTokens: 1000 })
    app = Fastify()
    await registerMessageRoutes(app)
    await registerChatRoutes(app)
  })
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.leaseCount = 0
    mocks.controller.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/v1/capacity-reservations') return Response.json({ id: randomUUID() })
      if (path === '/v1/leases' && init?.method === 'POST') return Response.json({ id: `controller-${++mocks.leaseCount}` })
      if (path.endsWith('/v1/files/missing')) return Response.json({ missing: [], preserveExisting: true })
      if (path.endsWith('/v1/operations')) return Response.json({ id: 'operation', status: 'completed', output: 'ok', exitCode: 0 })
      return Response.json({})
    })
    // Each case has a separate chat. Completed fixtures cannot hold the capacity queue.
    await db.update(responses).set({ status: 'completed' }).where(eq(responses.userId, mocks.userId))
    chatId = randomUUID()
    await db.insert(chats).values({ id: chatId, userId: mocks.userId, modelId })
  })
  afterAll(async () => {
    config.WORKSPACE_CONTROLLER_URL = originalUrl; config.WORKSPACE_CONTROLLER_TOKEN = originalToken
    await app?.close()
    await db.delete(chats).where(eq(chats.userId, mocks.userId))
    await db.delete(models).where(eq(models.id, modelId))
    await db.delete(providerConnections).where(eq(providerConnections.id, providerId))
    await db.delete(users).where(eq(users.id, mocks.userId))
    await queryClient.end()
  })

  it('retains scope across forward plain messages and an idempotent retry', async () => {
    const first = await send(); await finish(first.id)
    const second = await send({ idempotencyKey: 'forward' })
    expect(second.parentResponseId).toBe(first.id)
    expect(second.workspaceScopeId).toBe(first.workspaceScopeId)
    const retry = await send({ idempotencyKey: 'forward' })
    expect(retry.id).toBe(second.id)
    expect((await chat()).workspaceScopeId).toBe(first.workspaceScopeId)
    expect(mocks.queue).toHaveBeenCalledTimes(2)
  })

  it('atomically assigns distinct scopes to concurrent siblings and active continuations', async () => {
    const parent = await send(); await finish(parent.id)
    const [a, b] = await Promise.all([send({ parentResponseId: parent.id }), send({ parentResponseId: parent.id })])
    expect(a.workspaceScopeId).not.toBe(b.workspaceScopeId)
    const leaf = await chat()
    const next = await send()
    expect(next.parentResponseId).toBe(leaf.activeResponseId)
    expect(next.workspaceScopeId).not.toBe(leaf.workspaceScopeId)
  })

  it('returns the same scope for racing idempotency requests without advancing history twice', async () => {
    const [a, b] = await Promise.all([send({ idempotencyKey: 'racing' }), send({ idempotencyKey: 'racing' })])
    expect(a.id).toBe(b.id)
    expect(a.workspaceScopeId).toBe(b.workspaceScopeId)
    expect(mocks.queue).toHaveBeenCalledOnce()
  })

  it('resets on regeneration and both edit types without cancelling the original', async () => {
    const original = await send()
    for (const [method, url, payload] of [
      ['POST', `/api/messages/${original.id}/regenerate`, { modelId }],
      ['PATCH', `/api/messages/${original.id}:input`, { content: 'edited user', modelId }],
      ['PATCH', `/api/messages/${original.id}`, { content: 'edited assistant' }],
    ] as const) {
      const before = await chat()
      const result = await app.inject({ method, url, payload })
      expect(result.statusCode, result.body).toBeLessThan(300)
      const after = await chat()
      expect(after.workspaceScopeId).not.toBe(before.workspaceScopeId)
      expect(after.workspaceScopeId).not.toBe(original.workspaceScopeId)
      const [created] = await db.select().from(responses).where(eq(responses.id, after.activeResponseId!))
      expect(created?.workspaceScopeId).toBe(after.workspaceScopeId)
    }
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('rotates scope on branch switches and active deletion, but not same-leaf activation or unrelated deletion', async () => {
    const a = await send(); await finish(a.id)
    const b = await send({ parentResponseId: null, branchReason: 'regenerate' }); await finish(b.id)
    const bScope = (await chat()).workspaceScopeId
    expect((await app.inject({ method: 'POST', url: `/api/messages/${b.id}/activate` })).statusCode).toBe(200)
    expect((await chat()).workspaceScopeId).toBe(bScope)
    await app.inject({ method: 'POST', url: `/api/messages/${a.id}/activate` })
    const selectedScope = (await chat()).workspaceScopeId
    expect(selectedScope).not.toBe(bScope)
    expect(selectedScope).not.toBe(a.workspaceScopeId)
    await app.inject({ method: 'DELETE', url: `/api/messages/${b.id}` })
    expect((await chat()).workspaceScopeId).toBe(selectedScope)
    await app.inject({ method: 'DELETE', url: `/api/messages/${a.id}` })
    expect((await chat()).workspaceScopeId).not.toBe(selectedScope)
    expect(mocks.controller).not.toHaveBeenCalled()
  })

  it('coalesces acquisition across managers, isolates branches, and leaves the older execution usable', async () => {
    const a = await send(), b = await send({ parentResponseId: null, branchReason: 'regenerate' })
    const old = new WorkspaceManager(a.id, chatId, mocks.userId)
    const duplicate = new WorkspaceManager(a.id, chatId, mocks.userId)
    const replacement = new WorkspaceManager(b.id, chatId, mocks.userId)
    const [one, two, three] = await Promise.all([old.ensureLease(), old.ensureLease(), duplicate.ensureLease()])
    expect(one).toBe(two); expect(two).toBe(three)
    expect(mocks.leaseCount).toBe(1)
    const newLease = await replacement.ensureLease()
    expect(newLease).not.toBe(one)
    await old.execute('old-operation', 'write', { path: '/workspace/old', content: 'old' })
    expect(mocks.controller).toHaveBeenLastCalledWith(`/v1/leases/${one}/v1/operations`, expect.anything())
    await expect(replacement.readGeneratedFile('/workspace/old', one)).rejects.toThrow('original image workspace')
    await releaseWorkspaceForChat(chatId)
    const leases = await db.select().from(workspaceLeases).where(eq(workspaceLeases.chatId, chatId))
    expect(leases).toHaveLength(2)
    expect(leases.every(lease => lease.status === 'released')).toBe(true)
    expect(mocks.controller.mock.calls.filter(([path, init]) => /^\/v1\/leases\/[^/]+$/.test(path) && init?.method === 'DELETE')).toHaveLength(2)
  })

  it('restores selected-lineage files and current-response deliverables only', async () => {
    const ancestor = await send(); await finish(ancestor.id)
    const discarded = await send(); await finish(discarded.id)
    const current = await send({ parentResponseId: ancestor.id, branchReason: 'regenerate' })
    const uploadId = randomUUID(), removedId = randomUUID()
    await db.insert(attachments).values([
      { id: uploadId, origin: 'user', sourceResponseId: null, originalName: 'input.txt', workspacePath: null, checksum: 'input' },
      { id: removedId, origin: 'user', sourceResponseId: null, originalName: 'removed.txt', workspacePath: null, checksum: 'removed' },
      { id: randomUUID(), origin: 'assistant', sourceResponseId: ancestor.id, originalName: 'report.txt', workspacePath: '/workspace/report.txt', checksum: 'old' },
      { id: randomUUID(), origin: 'assistant', sourceResponseId: discarded.id, originalName: 'discarded.txt', workspacePath: '/workspace/discarded.txt', checksum: 'discarded' },
      { id: randomUUID(), origin: 'assistant', sourceResponseId: current.id, originalName: 'report.txt', workspacePath: '/workspace/report.txt', checksum: 'new' },
      { id: randomUUID(), origin: 'tool_preview', sourceResponseId: ancestor.id, originalName: 'preview.txt', workspacePath: null, checksum: 'preview' },
    ].map(file => ({ ...file, userId: mocks.userId, chatId, mimeType: 'text/plain', sizeBytes: 1, objectKey: file.id, status: 'ready' as const })))
    await db.update(responses).set({ input: [{ role: 'user', content: [{ type: 'input_file', attachment_id: uploadId }] }] }).where(eq(responses.id, ancestor.id))
    const manager = new WorkspaceManager(current.id, chatId, mocks.userId)
    const notice = await manager.contextNotice()
    expect(notice).toContain('report.txt'); expect(notice).toContain('input.txt')
    expect(notice).not.toMatch(/discarded|removed|preview/)
    await manager.ensureLease()
    const inventoryCall = mocks.controller.mock.calls.find(([path]) => path.endsWith('/v1/files/missing'))!
    const inventory = JSON.parse(inventoryCall[1].body)
    expect(inventory.files.map((file: { checksum: string }) => file.checksum)).toEqual(['new', 'input'])
  })

  it('rolls back a failed admission without losing a concurrently accepted descendant', async () => {
    let fail!: (error: Error) => void, started!: () => void
    const reserving = new Promise<void>(resolve => { started = resolve })
    vi.mocked(reserveBudget).mockImplementationOnce(async () => { started(); return new Promise((_resolve, reject) => { fail = reject }) })
    const first = send()
    const rejected = expect(first).rejects.toThrow('budget unavailable')
    await reserving
    const parentId = (await chat()).activeResponseId!
    const descendant = await send()
    fail(new Error('budget unavailable'))
    await rejected
    const [parent] = await db.select().from(responses).where(eq(responses.id, parentId))
    expect(parent?.status).toBe('failed')
    expect(descendant.parentResponseId).toBe(parentId)
    expect((await chat()).activeResponseId).toBe(descendant.id)
    expect((await chat()).workspaceScopeId).toBe(descendant.workspaceScopeId)
  })

  it('gives duplicated chats independent scopes and hides internal identities', async () => {
    const source = await send(); await finish(source.id)
    const result = await app.inject({ method: 'POST', url: `/api/chats/${chatId}/duplicate` })
    expect(result.statusCode, result.body).toBe(201)
    expect(result.json()).not.toHaveProperty('workspaceScopeId')
    const copyId = result.json().id as string
    const [copy] = await db.select().from(chats).where(eq(chats.id, copyId))
    const copiedResponses = await db.select().from(responses).where(eq(responses.chatId, copyId))
    expect(copy?.workspaceScopeId).not.toBe(source.workspaceScopeId)
    expect(copiedResponses[0]?.workspaceScopeId).not.toBe(source.workspaceScopeId)
    const next = await send({ chatId: copyId })
    expect(next.workspaceScopeId).toBe(copy?.workspaceScopeId)
  })

  it('isolates continuation while a cancelled predecessor is still stopping', async () => {
    const original = await send()
    await db.insert(agentRuns).values({ id: randomUUID(), responseId: original.id, status: 'running' })
    await db.update(responses).set({ status: 'cancelled' }).where(eq(responses.id, original.id))
    expect((await send()).workspaceScopeId).not.toBe(original.workspaceScopeId)
  })

  it('keeps one assistant-edit scope under simultaneous idempotent requests', async () => {
    const original = await send()
    const request = { method: 'PATCH' as const, url: `/api/messages/${original.id}`, payload: { content: 'edited' }, headers: { 'idempotency-key': 'same-edit' } }
    const results = await Promise.all([app.inject(request), app.inject(request)])
    expect(results.map(result => result.statusCode)).toEqual([201, 201])
    expect(results[0]!.json().response.responseId).toBe(results[1]!.json().response.responseId)
    const edited = await db.select().from(responses).where(and(eq(responses.chatId, chatId), eq(responses.branchReason, 'assistant_edit')))
    expect(edited).toHaveLength(1)
    expect((await chat()).workspaceScopeId).toBe(edited[0]!.workspaceScopeId)
  })

  it('does not resurrect a lease released during provisioning', async () => {
    const response = await send()
    let unblock!: () => void, started!: () => void
    const pending = new Promise<void>(resolve => { unblock = resolve })
    const claiming = new Promise<void>(resolve => { started = resolve })
    const normal = mocks.controller.getMockImplementation()!
    mocks.controller.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/v1/leases' && init?.method === 'POST') { started(); await pending }
      return normal(path, init)
    })
    const acquisition = new WorkspaceManager(response.id, chatId, mocks.userId).ensureLease()
    const rejected = expect(acquisition).rejects.toThrow('cancelled')
    await claiming
    await releaseWorkspaceForChat(chatId)
    unblock()
    await rejected
    const leases = await db.select().from(workspaceLeases).where(eq(workspaceLeases.chatId, chatId))
    expect(leases.map(lease => lease.status)).toEqual(['released'])
    expect(mocks.controller).toHaveBeenCalledWith('/v1/leases/controller-1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('refreshes the reset notice and lease after the controller loses the original workspace', async () => {
    const response = await send()
    await readyLease(response, { controllerLeaseId: 'lost' })
    const normal = mocks.controller.getMockImplementation()!
    mocks.controller.mockImplementation(async (path: string, init?: { method?: string }) => path === '/v1/leases/lost/v1/operations'
      ? new Response('Lease missing', { status: 404 }) : normal(path, init))
    const manager = new WorkspaceManager(response.id, chatId, mocks.userId)
    expect(await manager.contextNotice()).toContain('Continuing')
    await manager.execute('operation', 'read', { path: '/workspace/x' })
    expect(await manager.contextNotice()).toContain('fresh workspace')
    expect(mocks.leaseCount).toBe(1)
  })

  it('ignores legacy leases, replaces expired scopes, and resumes the same response lease', async () => {
    const response = await send()
    await readyLease(response, { workspaceScopeId: null, controllerLeaseId: 'legacy' })
    const expired = await readyLease(response, { expiresAt: new Date(0), controllerLeaseId: 'expired' })
    const manager = new WorkspaceManager(response.id, chatId, mocks.userId)
    expect(await manager.contextNotice()).toContain('fresh workspace')
    expect(mocks.controller).not.toHaveBeenCalled()
    const acquired = await manager.ensureLease()
    expect(acquired).not.toBe('legacy'); expect(acquired).not.toBe('expired')
    expect((await db.select().from(workspaceLeases).where(eq(workspaceLeases.id, expired.id)))[0]?.status).toBe('expired')
    expect(await new WorkspaceManager(response.id, chatId, mocks.userId).ensureLease()).toBe(acquired)
    expect(mocks.leaseCount).toBe(1)
    const active = await db.select().from(workspaceLeases).where(and(eq(workspaceLeases.workspaceScopeId, response.workspaceScopeId), eq(workspaceLeases.status, 'ready')))
    expect(active).toHaveLength(1)
    await expect(readyLease(response)).rejects.toThrow()
  })
})
