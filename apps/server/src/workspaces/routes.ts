import { cancelManagedOperations } from './cancellation.js'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { computerRegistrationSchema, workspaceRecoverySchema, resolveWorkspace } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chats, responses, workspaceComputers, workspaceOperations } from '../database/schema.js'
import { currentSessionId } from '../auth/service.js'
import { unauthorized, AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { listComputers, credentialHash, deviceCredential, validateWorkspace, responseLock } from './service.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import { publishSnapshot } from '../responses/events.js'
import { toSnapshot } from '../responses/service.js'

async function actor(request: FastifyRequest) {
  if (!request.user || request.user.blocked || request.apiKeyId || request.managementTokenId || request.adminChatAccess) throw unauthorized()
  return { userId: request.user.id, sessionId: await currentSessionId(request, request.user.id) }
}
export async function registerWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me/computers', async request => ({ computers: await listComputers((await actor(request)).userId) }))
  app.post('/api/me/computers', async request => {
    const owner = await actor(request)
    const registration = computerRegistrationSchema.parse(request.body)
    const token = deviceCredential(); const id = newId()
    await db.insert(workspaceComputers).values({ id, ...owner, registration, tokenHash: credentialHash(token) })
    return { id, token }
  })
  app.delete('/api/me/computers/:id', async request => {
    const owner = await actor(request); const { id } = request.params as { id: string }
    await db.update(workspaceComputers).set({ revokedAt: new Date(), lastSeenAt: null }).where(and(eq(workspaceComputers.id, id), eq(workspaceComputers.userId, owner.userId)))
    await db.update(workspaceOperations).set({ cancelRequested: true }).where(and(eq(workspaceOperations.deviceId, id), sql`${workspaceOperations.deviceId} in (select id from workspace_computers where user_id = ${owner.userId})`))
    return { ok: true }
  })
  app.post('/api/responses/:id/workspace-recovery', async request => {
    const owner = await actor(request); const { id } = request.params as { id: string }
    const input = workspaceRecoverySchema.parse(request.body)
    const target = input.action === 'none' ? { kind: 'none' as const } : input.action === 'switch' ? input.workspace : undefined
    if (target) await validateWorkspace(owner.userId, target)
    const response = await db.transaction(async tx => {
      await tx.execute(responseLock(id))
      const [row] = await tx.select({ response: responses }).from(responses).innerJoin(chats, eq(chats.id, responses.chatId))
        .where(and(eq(responses.id, id), eq(responses.userId, owner.userId), isNull(responses.deletedAt), isNull(chats.deletedAt), accessibleChatCondition())).limit(1)
      const response = row?.response
      const waiting = response?.workspaceWait
      if (!response || !waiting || response.status !== 'in_progress' || response.workspaceGeneration !== input.generation) throw new AppError(409, 'workspace_not_waiting', 'This workspace wait has already changed. Refresh and try again.')
      if (input.action === 'wait') {
        const duration = Math.max(30_000, Date.parse(waiting.deadline) - Date.parse(waiting.startedAt))
        const [updated] = await tx.update(responses).set({ workspaceWait: { ...waiting, startedAt: new Date().toISOString(), deadline: new Date(Date.now() + duration).toISOString() }, updatedAt: new Date() }).where(eq(responses.id, id)).returning()
        return updated!
      }
      if (waiting.mayHaveStarted && !input.acknowledgeUnknown) throw new AppError(409, 'workspace_outcome_unknown', 'The old command may still run. Confirm before switching.')
      await tx.update(workspaceOperations).set({ retiredAt: new Date(), cancelRequested: true }).where(and(eq(workspaceOperations.responseId, id), eq(workspaceOperations.generation, input.generation)))
      const [updated] = await tx.update(responses).set({ workspace: resolveWorkspace(target), workspaceGeneration: input.generation + 1, workspaceWait: null, agentCapacityAction: input.action === 'none' ? 'continue_without_agent' : null, updatedAt: new Date() }).where(eq(responses.id, id)).returning()
      return updated!
    })
    if (input.action !== 'wait') await cancelManagedOperations(id)
    console.info(JSON.stringify({ event: 'workspace.recovery', responseId: id, action: input.action, generation: response.workspaceGeneration }))
    await publishSnapshot(toSnapshot(response))
    return toSnapshot(response)
  })
}
