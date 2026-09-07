import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { idSchema } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { users } from '../database/schema.js'
import { getConfig } from '../config.js'
import { notFound, unauthorized } from '../lib/errors.js'
import { currentSessionId, requireAdmin } from './service.js'
import { listDeviceSessions, revokeDeviceSessions, type SessionRevocation } from './device-sessions.js'

async function accountSession(request: FastifyRequest) {
  if (!request.user || request.user.blocked || request.apiKeyId || request.managementTokenId || request.adminChatAccess) throw unauthorized()
  return { userId: request.user.id, sessionId: await currentSessionId(request, request.user.id) }
}

export async function registerDeviceSessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me/sessions', async (request, reply) => {
    const actor = await accountSession(request)
    reply.header('cache-control', 'no-store')
    return listDeviceSessions(actor.userId, actor.sessionId)
  })
  app.delete('/api/me/sessions/:sessionId', async (request, reply) => {
    const actor = await accountSession(request)
    const { sessionId } = z.object({ sessionId: idSchema }).parse(request.params)
    await revokeDeviceSessions(actor.userId, actor.userId, { kind: 'one', sessionId })
    if (sessionId === actor.sessionId) reply.clearCookie(getConfig().SESSION_COOKIE_NAME, { path: '/' })
    return reply.code(204).send()
  })
  app.post('/api/me/sessions/revoke-others', async (request, reply) => {
    const actor = await accountSession(request)
    await revokeDeviceSessions(actor.userId, actor.userId, { kind: 'others', currentId: actor.sessionId })
    return reply.code(204).send()
  })

  async function adminTarget(request: FastifyRequest) {
    const actor = await accountSession(request)
    requireAdmin(request)
    const { userId } = z.object({ userId: idSchema }).parse(request.params)
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
    if (!target) throw notFound('User')
    return { actor, userId }
  }
  app.get('/api/admin/users/:userId/sessions', async (request, reply) => {
    const { actor, userId } = await adminTarget(request)
    reply.header('cache-control', 'no-store')
    return listDeviceSessions(userId, actor.sessionId)
  })
  for (const kind of ['one', 'all'] as const) {
    app.route({
      method: kind === 'one' ? 'DELETE' : 'POST',
      url: `/api/admin/users/:userId/sessions/${kind === 'one' ? ':sessionId' : 'revoke-all'}`,
      handler: async (request, reply) => {
        const { actor, userId } = await adminTarget(request)
        const input: SessionRevocation = kind === 'all' ? { kind } : { kind, sessionId: z.object({ sessionId: idSchema }).parse(request.params).sessionId }
        await revokeDeviceSessions(actor.userId, userId, input)
        if (userId === actor.userId && (input.kind === 'all' || (input.kind === 'one' && input.sessionId === actor.sessionId))) {
          reply.clearCookie(getConfig().SESSION_COOKIE_NAME, { path: '/' })
        }
        return reply.code(204).send()
      },
    })
  }
}
