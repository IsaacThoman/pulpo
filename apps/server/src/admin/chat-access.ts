import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { db } from '../database/client.js'
import { attachments, auditEvents, chats, chatShares, responses, users } from '../database/schema.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { redis } from '../redis.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import {
  hasTwoFactor,
  verifySecondFactor,
} from '../auth/two-factor.js'
import {
  requireUser,
  serializeUser,
  type AdminChatAccessContext,
  type AuthenticatedUser,
} from '../auth/service.js'

const ACCESS_TTL_SECONDS = 30 * 60
export const ADMIN_CHAT_ACCESS_HEADER = 'x-pulpo-admin-chat-access'

interface StoredGrant {
  accessId: string
  actorUserId: string
  ownerUserId: string
  chatId: string
  reason: string
  expiresAt: string
}

function grantKey(token: string): string {
  return `pulpo:admin-chat-access:${hashToken(token)}`
}

function accessToken(request: FastifyRequest): string | undefined {
  const value = request.headers[ADMIN_CHAT_ACCESS_HEADER]
  return typeof value === 'string' && value.length >= 32 ? value : undefined
}

async function loadGrant(token: string): Promise<StoredGrant | null> {
  const raw = await redis.get(grantKey(token))
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredGrant
  } catch {
    return null
  }
}

async function audit(input: {
  actorUserId: string | null
  action: string
  chatId: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId(),
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: 'chat',
    targetId: input.chatId,
    metadata: input.metadata ?? {},
  })
}

function resourceId(pathname: string, prefix: string): string | null {
  const match = new RegExp(`^${prefix}/([^/?]+)`).exec(pathname)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

async function chatIdForScopedRequest(request: FastifyRequest): Promise<string | null> {
  const pathname = request.url.split('?')[0]!
  const directChatId = resourceId(pathname, '/api/chats')
  if (directChatId && directChatId !== 'order' && directChatId !== 'deleted' && directChatId !== 'search' && directChatId !== 'export' && directChatId !== 'import' && directChatId !== 'start') {
    return directChatId
  }

  const messageId = resourceId(pathname, '/api/messages')?.replace(/:input$/, '')
  if (messageId) {
    const [row] = await db.select({ chatId: responses.chatId }).from(responses).where(eq(responses.id, messageId)).limit(1)
    return row?.chatId ?? null
  }

  const responseId = resourceId(pathname, '/api/responses')
  if (responseId) {
    const [row] = await db.select({ chatId: responses.chatId }).from(responses).where(eq(responses.id, responseId)).limit(1)
    return row?.chatId ?? null
  }

  if (pathname === '/api/attachments' && request.method === 'POST') {
    const value = (request.body as { chatId?: unknown } | null)?.chatId
    return typeof value === 'string' ? value : null
  }
  const attachmentId = resourceId(pathname, '/api/attachments')
  if (attachmentId && !['usage', 'local-upload', 'local-download'].includes(attachmentId)) {
    const [row] = await db.select({ chatId: attachments.chatId }).from(attachments).where(eq(attachments.id, attachmentId)).limit(1)
    return row?.chatId ?? null
  }
  const uploadKey = resourceId(pathname, '/api/attachments/local-upload')
  const downloadKey = resourceId(pathname, '/api/attachments/local-download')
  const objectKey = uploadKey ?? downloadKey
  if (objectKey) {
    const [row] = await db.select({ chatId: attachments.chatId }).from(attachments).where(eq(attachments.objectKey, objectKey)).limit(1)
    return row?.chatId ?? null
  }

  if (pathname === '/api/chat-shares' && request.method === 'POST') {
    const value = (request.body as { chatId?: unknown } | null)?.chatId
    return typeof value === 'string' ? value : null
  }
  if (pathname === '/api/chat-shares' && request.method === 'GET') {
    const value = (request.query as { chatId?: unknown } | null)?.chatId
    return typeof value === 'string' ? value : null
  }
  const shareId = resourceId(pathname, '/api/chat-shares')
  if (shareId) {
    const [row] = await db.select({ chatId: chatShares.chatId }).from(chatShares).where(eq(chatShares.id, shareId)).limit(1)
    return row?.chatId ?? null
  }

  if (pathname === '/api/folders' && request.method === 'GET') return '__folder_metadata__'
  return null
}

function safeResourceMetadata(request: FastifyRequest): Record<string, unknown> {
  const params = request.params && typeof request.params === 'object'
    ? Object.fromEntries(Object.entries(request.params as Record<string, unknown>)
      .filter(([key, value]) => ['id', 'messageId'].includes(key) && typeof value === 'string'))
    : {}
  return {
    accessId: request.adminChatAccess?.accessId,
    ownerUserId: request.adminChatAccess?.ownerUser.id,
    method: request.method,
    route: request.routeOptions.url,
    ...params,
  }
}

function auditActionForRequest(request: FastifyRequest): string {
  const pathname = request.url.split('?')[0]!
  if (request.method === 'GET' && pathname.startsWith('/api/attachments/')) return 'chat.admin_access.attachment_read'
  if (request.method === 'GET' && pathname.startsWith('/api/chats/')) return 'chat.admin_access.transcript_open'
  if (pathname.endsWith('/duplicate')) return 'chat.admin_access.duplicate'
  if (pathname.startsWith('/api/chat-shares')) return 'chat.admin_access.share'
  if (pathname.endsWith('/permanent')) return 'chat.admin_access.permanent_delete'
  if (pathname.endsWith('/recover')) return 'chat.admin_access.recover'
  if (request.method === 'DELETE' && /^\/api\/chats\/[^/]+$/.test(pathname)) return 'chat.admin_access.trash'
  return request.method === 'GET' ? 'chat.admin_access.read' : 'chat.admin_access.mutate'
}

export async function resolveAdminChatSocketAccess(
  token: string,
  actor: AuthenticatedUser,
): Promise<AdminChatAccessContext | null> {
  if (actor.role !== 'admin') return null
  const grant = await loadGrant(token)
  if (!grant || grant.actorUserId !== actor.id || new Date(grant.expiresAt) <= new Date()) return null
  const [owner] = await db.select().from(users).where(eq(users.id, grant.ownerUserId)).limit(1)
  const [chat] = await db.select({ id: chats.id }).from(chats).where(and(
    eq(chats.id, grant.chatId), eq(chats.userId, grant.ownerUserId), isNull(chats.purgeStartedAt), accessibleChatCondition(),
  )).limit(1)
  if (!owner || !chat) return null
  return {
    accessId: grant.accessId,
    actorUser: actor,
    ownerUser: serializeUser(owner),
    chatId: grant.chatId,
    reason: grant.reason,
    expiresAt: grant.expiresAt,
  }
}

export async function registerAdminChatAccess(app: FastifyInstance): Promise<void> {
  app.post('/api/admin/chats/:chatId/access', async (request, reply) => {
    const { chatId } = z.object({ chatId: z.uuid() }).parse(request.params)
    const authenticated = requireUser(request)
    if (authenticated.role !== 'admin') {
      await audit({ actorUserId: authenticated.id, action: 'chat.admin_access.denied', chatId, metadata: { reason: 'not_admin' } })
      throw new AppError(403, 'forbidden', 'Admin access required')
    }
    const admin = authenticated
    const parsed = z.object({
      reason: z.string().trim().min(10).max(500),
      verificationCode: z.string().trim().min(6).max(32),
    }).safeParse(request.body)
    if (!parsed.success) {
      await audit({ actorUserId: admin.id, action: 'chat.admin_access.denied', chatId, metadata: { reason: 'invalid_request' } })
      throw new AppError(400, 'invalid_admin_chat_access_request', 'A reason of 10–500 characters and a verification code are required')
    }
    const input = parsed.data
    if (!(await hasTwoFactor(admin.id))) {
      await audit({ actorUserId: admin.id, action: 'chat.admin_access.denied', chatId, metadata: { reason: 'two_factor_not_enabled' } })
      throw new AppError(403, 'admin_two_factor_required', 'Enable two-factor authentication before accessing user chats')
    }
    try {
      await verifySecondFactor(admin.id, input.verificationCode)
    } catch (error) {
      await audit({ actorUserId: admin.id, action: 'chat.admin_access.denied', chatId, metadata: { reason: 'invalid_second_factor' } })
      throw error
    }
    const [row] = await db.select({ chat: chats, owner: users }).from(chats)
      .innerJoin(users, eq(users.id, chats.userId)).where(and(
        eq(chats.id, chatId), isNull(chats.purgeStartedAt), accessibleChatCondition(),
      )).limit(1)
    if (!row) {
      await audit({ actorUserId: admin.id, action: 'chat.admin_access.denied', chatId, metadata: { reason: 'chat_not_found' } })
      throw notFound('Chat')
    }
    const token = randomToken(32)
    const accessId = newId()
    const expiresAt = new Date(Date.now() + ACCESS_TTL_SECONDS * 1_000)
    const grant: StoredGrant = {
      accessId,
      actorUserId: admin.id,
      ownerUserId: row.owner.id,
      chatId,
      reason: input.reason,
      expiresAt: expiresAt.toISOString(),
    }
    await redis.set(grantKey(token), JSON.stringify(grant), 'EX', ACCESS_TTL_SECONDS)
    await audit({
      actorUserId: admin.id,
      action: 'chat.admin_access.start',
      chatId,
      metadata: { accessId, ownerUserId: row.owner.id, reason: input.reason, expiresAt: grant.expiresAt },
    })
    reply.code(201)
    return {
      accessToken: token,
      accessId,
      expiresAt: grant.expiresAt,
      reason: grant.reason,
      owner: {
        id: row.owner.id,
        email: row.owner.email,
        name: row.owner.name,
        username: row.owner.username,
        role: row.owner.role,
        blocked: row.owner.blocked,
      },
      chat: {
        id: row.chat.id,
        title: row.chat.title,
        temporary: row.chat.temporary,
        deletedAt: row.chat.deletedAt?.toISOString() ?? null,
        expiresAt: row.chat.expiresAt?.toISOString() ?? null,
      },
    }
  })

  app.delete('/api/admin/chats/:chatId/access', async (request, reply) => {
    const admin = requireUser(request)
    if (admin.role !== 'admin') throw new AppError(403, 'forbidden', 'Admin access required')
    const { chatId } = z.object({ chatId: z.uuid() }).parse(request.params)
    const token = accessToken(request)
    const grant = token ? await loadGrant(token) : null
    if (!token || !grant || grant.actorUserId !== admin.id || grant.chatId !== chatId) {
      throw new AppError(403, 'admin_chat_access_invalid', 'Admin chat access is invalid or expired')
    }
    await redis.del(grantKey(token))
    await audit({ actorUserId: admin.id, action: 'chat.admin_access.end', chatId, metadata: { accessId: grant.accessId, ownerUserId: grant.ownerUserId } })
    reply.code(204).send()
  })

  app.addHook('preValidation', async (request) => {
    if (request.url.startsWith('/api/admin/')) return
    const token = accessToken(request)
    if (!token) return
    const actor = requireUser(request)
    if (actor.role !== 'admin') throw new AppError(403, 'forbidden', 'Admin access required')
    const context = await resolveAdminChatSocketAccess(token, actor)
    if (!context) throw new AppError(403, 'admin_chat_access_invalid', 'Admin chat access is invalid or expired')
    request.adminChatAccess = context
    const scopedChatId = await chatIdForScopedRequest(request)
    if (scopedChatId !== context.chatId && scopedChatId !== '__folder_metadata__') {
      throw new AppError(403, 'admin_chat_scope_mismatch', 'This admin access grant is limited to another chat')
    }
    request.user = context.ownerUser
  })

  app.addHook('onResponse', async (request, reply) => {
    const context = request.adminChatAccess
    if (!context) return
    await audit({
      actorUserId: context.actorUser.id,
      action: auditActionForRequest(request),
      chatId: context.chatId,
      metadata: {
        ...safeResourceMetadata(request),
        outcome: reply.statusCode < 400 ? 'success' : 'failure',
        statusCode: reply.statusCode,
      },
    })
  })
}
