import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { ZodError } from 'zod'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AdminMessageReport } from '@pulpo/contracts'
import type { AuthenticatedUser } from '../auth/service.js'
import { db, queryClient } from '../database/client.js'
import { applicationSettings, auditEvents, chats, messageReports, models, providerConnections, responses, users } from '../database/schema.js'
import { registerMessageReportRoutes } from './routes.js'

const enabled = process.env.PULPO_MESSAGE_REPORT_TESTS === 'true'

describe.skipIf(!enabled)('message report routes', () => {
  let app: FastifyInstance
  let actor: AuthenticatedUser | undefined
  let owner: AuthenticatedUser
  let admin: AuthenticatedUser
  let chatId: string
  let responseId: string
  let modelId: string

  const createUser = async (role: 'user' | 'admin'): Promise<AuthenticatedUser> => {
    const id = randomUUID()
    const [row] = await db.insert(users).values({ id, name: `Report ${role}`, email: `${id}@example.test`, username: `r${id.replaceAll('-', '')}`, role }).returning()
    return row as unknown as AuthenticatedUser
  }
  const setReportsEnabled = (value: boolean) => db.insert(applicationSettings)
    .values({ key: 'auth', value: { messageReportsEnabled: value } })
    .onConflictDoUpdate({ target: applicationSettings.key, set: { value: { messageReportsEnabled: value } } })
  const report = (body: unknown) => app.inject({ method: 'POST', url: '/api/message-reports', payload: body as object })

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_message_reports_test')) throw new Error('Use the disposable pulpo_message_reports_test database')
    app = Fastify()
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (request) => { (request as { user?: AuthenticatedUser }).user = actor })
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) return reply.code(400).send({ code: 'invalid_request' })
      const status = (error as { statusCode?: number }).statusCode ?? 500
      return reply.code(status).send({ code: (error as { code?: string }).code })
    })
    await registerMessageReportRoutes(app)
    const providerId = randomUUID()
    modelId = randomUUID()
    await db.insert(providerConnections).values({ id: providerId, name: 'Report test', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: modelId, providerConnectionId: providerId, name: 'Report test', upstreamModelId: 'unused', contextWindow: 4096, maxOutputTokens: 1024 })
  })

  beforeEach(async () => {
    owner = await createUser('user')
    admin = await createUser('admin')
    chatId = randomUUID()
    responseId = randomUUID()
    await db.insert(chats).values({ id: chatId, userId: owner.id, modelId, title: 'Reported chat' })
    await db.insert(responses).values({
      id: responseId, chatId, userId: owner.id, modelId, status: 'completed',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Cite a source for this.' }] }],
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `  ${'Here is a made-up citation. '.repeat(40)}` }] }],
    })
    await setReportsEnabled(true)
    actor = owner
  })

  afterAll(async () => {
    await app?.close()
    await queryClient.end()
  })

  it('is off by default and while disabled', async () => {
    await db.delete(applicationSettings).where(eq(applicationSettings.key, 'auth'))
    expect((await report({ messageId: responseId })).statusCode).toBe(403)
    await setReportsEnabled(false)
    expect((await report({ messageId: responseId })).statusCode).toBe(403)
    expect(await db.select().from(messageReports).where(eq(messageReports.chatId, chatId))).toEqual([])
  })

  it('records reports of responses and user messages with an audit event', async () => {
    const response = await report({ messageId: responseId, context: '  Made up a citation.  ' })
    expect(response.statusCode).toBe(201)
    const input = await report({ messageId: `${responseId}:input` })
    expect(input.statusCode).toBe(201)
    const rows = await db.select().from(messageReports).where(eq(messageReports.chatId, chatId))
    expect(rows.map((row) => [row.messageRole, row.context, row.userId]).sort()).toEqual([
      ['assistant', 'Made up a citation.', owner.id],
      ['user', '', owner.id],
    ])
    const excerpts = Object.fromEntries(rows.map((row) => [row.messageRole, row.excerpt]))
    expect(excerpts.user).toBe('Cite a source for this.')
    expect(excerpts.assistant).toHaveLength(500)
    expect(excerpts.assistant!.startsWith('Here is a made-up citation.')).toBe(true)
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.targetId, chatId))
    expect(audits.filter((event) => event.action === 'chat.report.created')).toHaveLength(2)
  })

  it('only lets owners report their own live messages', async () => {
    actor = await createUser('user')
    expect((await report({ messageId: responseId })).statusCode).toBe(404)
    actor = owner
    expect((await report({ messageId: randomUUID() })).statusCode).toBe(404)
    expect((await report({ messageId: 'not-a-message' })).statusCode).toBe(400)
    expect((await report({ messageId: '-'.repeat(36) })).statusCode).toBe(400)
    expect((await report({ messageId: `${'a'.repeat(36)}:input` })).statusCode).toBe(400)
    expect((await report({ messageId: responseId, context: 'x'.repeat(2_001) })).statusCode).toBe(400)
    await db.update(responses).set({ status: 'in_progress' }).where(eq(responses.id, responseId))
    expect((await report({ messageId: responseId })).statusCode).toBe(409)
    expect((await report({ messageId: `${responseId}:input` })).statusCode).toBe(201)
    await db.update(chats).set({ deletedAt: new Date() }).where(eq(chats.id, chatId))
    expect((await report({ messageId: responseId })).statusCode).toBe(404)
    actor = undefined
    expect((await report({ messageId: responseId })).statusCode).toBe(401)
  })

  it('lists, resolves, and reopens reports for admins only', async () => {
    await report({ messageId: responseId, context: 'Please look' })
    const list = async (status: 'open' | 'resolved') => {
      const result = await app.inject({ method: 'GET', url: `/api/admin/message-reports?status=${status}` })
      return (result.json() as { data: AdminMessageReport[] }).data.filter((item) => item.chatId === chatId)
    }
    expect((await app.inject({ method: 'GET', url: '/api/admin/message-reports' })).statusCode).toBe(403)
    actor = admin
    const [open] = await list('open')
    const [viewed] = await db.select().from(auditEvents).where(and(eq(auditEvents.actorUserId, admin.id), eq(auditEvents.action, 'chat.report.list_viewed')))
    expect(viewed?.metadata).toMatchObject({ status: 'open', reportIds: expect.arrayContaining([open!.id]) })
    expect(open).toMatchObject({ chatTitle: 'Reported chat', responseId, messageRole: 'assistant', excerpt: expect.stringMatching(/^Here is a made-up citation\./), context: 'Please look', resolvedAt: null, reporter: { id: owner.id, email: owner.email } })

    actor = owner
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/message-reports/${open!.id}`, payload: { resolved: true } })).statusCode).toBe(403)
    actor = admin
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/message-reports/${open!.id}`, payload: { resolved: true } })).statusCode).toBe(200)
    expect(await list('open')).toEqual([])
    expect((await list('resolved'))[0]?.resolvedAt).toEqual(expect.any(String))
    // Resolving again changes nothing and records nothing.
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/message-reports/${open!.id}`, payload: { resolved: true } })).statusCode).toBe(200)
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.targetId, chatId))
    expect(audits.filter((event) => event.action === 'chat.report.resolved')).toHaveLength(1)
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/message-reports/${open!.id}`, payload: { resolved: false } })).statusCode).toBe(200)
    expect(await list('open')).toHaveLength(1)
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/message-reports/${randomUUID()}`, payload: { resolved: true } })).statusCode).toBe(404)
  })

  it('lists only reports admins can still open', async () => {
    await report({ messageId: responseId })
    actor = admin
    const listed = async () => {
      const result = await app.inject({ method: 'GET', url: '/api/admin/message-reports?status=open' })
      return (result.json() as { data: AdminMessageReport[] }).data.filter((item) => item.chatId === chatId)
    }
    expect(await listed()).toHaveLength(1)
    await db.update(chats).set({ temporary: true, expiresAt: new Date(Date.now() - 1_000) }).where(eq(chats.id, chatId))
    expect(await listed()).toEqual([])
    await db.update(chats).set({ temporary: false, expiresAt: null }).where(eq(chats.id, chatId))
    await db.update(chats).set({ deletedAt: new Date() }).where(eq(chats.id, chatId))
    expect(await listed()).toEqual([])
    await db.update(chats).set({ deletedAt: null }).where(eq(chats.id, chatId))
    await db.update(responses).set({ deletedAt: new Date() }).where(eq(responses.id, responseId))
    expect(await listed()).toEqual([])
  })

  it('goes away with the reported chat', async () => {
    await report({ messageId: responseId })
    await db.delete(chats).where(eq(chats.id, chatId))
    expect(await db.select().from(messageReports).where(eq(messageReports.responseId, responseId))).toEqual([])
  })
})
