import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  adminMessageReportStatusSchema,
  messageReportInputSchema,
  type AdminMessageReport,
} from '@pulpo/contracts'
import { requireAdmin, requireUser } from '../auth/service.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import { db } from '../database/client.js'
import { applicationSettings, auditEvents, chats, messageReports, responses, users } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { parseAuthSettings } from '../settings/application-settings.js'

export async function messageReportsEnabled(): Promise<boolean> {
  const [setting] = await db.select({ value: applicationSettings.value })
    .from(applicationSettings)
    .where(eq(applicationSettings.key, 'auth'))
    .limit(1)
  return parseAuthSettings(setting?.value).messageReportsEnabled
}

async function assertMessageReportsEnabled(): Promise<void> {
  if (!await messageReportsEnabled()) {
    throw new AppError(403, 'message_reports_disabled', 'Message reports are disabled')
  }
}

type ReportRow = {
  report: typeof messageReports.$inferSelect
  chatTitle: string
  reporter: Pick<typeof users.$inferSelect, 'id' | 'name' | 'username' | 'email'>
}

function serializeReport({ report, chatTitle, reporter }: ReportRow): AdminMessageReport {
  return {
    id: report.id,
    chatId: report.chatId,
    chatTitle,
    responseId: report.responseId,
    messageRole: report.messageRole === 'user' ? 'user' : 'assistant',
    context: report.context,
    reporter,
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
  }
}

export async function registerMessageReportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/message-reports', {
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const user = requireUser(request)
    await assertMessageReportsEnabled()
    const input = messageReportInputSchema.parse(request.body)
    const responseId = input.messageId.replace(/:input$/, '')
    const messageRole = input.messageId.endsWith(':input') ? 'user' : 'assistant'
    const [row] = await db.select({ chatId: chats.id }).from(responses)
      .innerJoin(chats, eq(chats.id, responses.chatId))
      .where(and(
        eq(responses.id, responseId),
        eq(responses.userId, user.id),
        isNull(responses.deletedAt),
        eq(chats.userId, user.id),
        isNull(chats.deletedAt),
        isNull(chats.purgeStartedAt),
        accessibleChatCondition(),
      ))
      .limit(1)
    if (!row) throw notFound('Message')
    const id = newId()
    await db.transaction(async (tx) => {
      await tx.insert(messageReports).values({
        id, chatId: row.chatId, responseId, userId: user.id, messageRole, context: input.context,
      })
      await tx.insert(auditEvents).values({
        id: newId(),
        actorUserId: user.id,
        action: 'chat.report.created',
        targetType: 'chat',
        targetId: row.chatId,
        metadata: { reportId: id, responseId, messageRole },
      })
    })
    reply.code(201)
    return { id }
  })

  app.get('/api/admin/message-reports', async (request) => {
    requireAdmin(request)
    const { status } = z.object({ status: adminMessageReportStatusSchema.default('open') }).parse(request.query)
    const rows = await db.select({
      report: messageReports,
      chatTitle: chats.title,
      reporter: { id: users.id, name: users.name, username: users.username, email: users.email },
    }).from(messageReports)
      .innerJoin(chats, eq(chats.id, messageReports.chatId))
      .innerJoin(users, eq(users.id, messageReports.userId))
      .where(status === 'open' ? isNull(messageReports.resolvedAt) : isNotNull(messageReports.resolvedAt))
      .orderBy(desc(messageReports.createdAt))
      .limit(200)
    return { data: rows.map(serializeReport) }
  })

  app.patch('/api/admin/message-reports/:id', async (request) => {
    const admin = requireAdmin(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const { resolved } = z.object({ resolved: z.boolean() }).parse(request.body)
    const [updated] = await db.update(messageReports)
      .set(resolved ? { resolvedAt: new Date(), resolvedByUserId: admin.id } : { resolvedAt: null, resolvedByUserId: null })
      .where(eq(messageReports.id, id))
      .returning({ chatId: messageReports.chatId })
    if (!updated) throw notFound('Report')
    await db.insert(auditEvents).values({
      id: newId(),
      actorUserId: admin.id,
      action: resolved ? 'chat.report.resolved' : 'chat.report.reopened',
      targetType: 'chat',
      targetId: updated.chatId,
      metadata: { reportId: id },
    })
    return { ok: true }
  })
}
