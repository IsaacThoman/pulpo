import type { FastifyInstance, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { updateAgentComputerSchema } from '@pulpo/contracts'
import { currentSessionId, requireUser } from '../../auth/service.js'
import { db } from '../../database/client.js'
import { applicationSettings } from '../../database/schema.js'
import { AppError } from '../../lib/errors.js'
import { resolveClientIp } from '../../lib/client-ip.js'
import { getConfig } from '../../config.js'
import { parseAgentSettings } from '../../settings/application-settings.js'
import { decideToolApproval, listPendingApprovals } from './approvals.js'
import { decidePairing, listPairings, requestPairing, revokePairing } from './pairings.js'
import { listComputers, revokeComputer, updateComputer } from './registry.js'

/** Session id for a signed-in device, or null for API-key and admin-access callers who cannot select computers. */
async function optionalSessionId(request: FastifyRequest, userId: string): Promise<string | null> {
  if (request.adminChatAccess) return null
  try { return await currentSessionId(request, userId) } catch { return null }
}

async function requiredSessionId(request: FastifyRequest, userId: string): Promise<string> {
  if (request.adminChatAccess) throw new AppError(403, 'computer_session_required', 'Computers can only be managed from a signed-in Pulpo device')
  try { return await currentSessionId(request, userId) } catch {
    throw new AppError(403, 'computer_session_required', 'Computers can only be managed from a signed-in Pulpo device')
  }
}

export async function computersFeatureEnabled(): Promise<boolean> {
  const [row] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
  return parseAgentSettings(row?.value).computersEnabled
}

export async function registerAgentComputerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agent/computers', async (request) => {
    const user = requireUser(request)
    if (!await computersFeatureEnabled()) return { computers: [], enabled: false }
    const computers = await listComputers(user.id, await optionalSessionId(request, user.id))
    return { computers, enabled: true }
  })

  app.patch('/api/agent/computers/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const patch = updateAgentComputerSchema.parse(request.body ?? {})
    const sessionId = await requiredSessionId(request, user.id)
    await updateComputer(user.id, sessionId, id, patch)
    const [computer] = (await listComputers(user.id, sessionId)).filter((entry) => entry.id === id)
    return { computer }
  })

  app.delete('/api/agent/computers/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    await revokeComputer(user.id, await optionalSessionId(request, user.id), id)
    reply.code(204)
    return null
  })

  app.get('/api/agent/computers/:id/pairings', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    return { pairings: await listPairings(user.id, await optionalSessionId(request, user.id), id) }
  })

  app.get('/api/agent/pairings', async (request) => {
    const user = requireUser(request)
    return { pairings: await listPairings(user.id, await optionalSessionId(request, user.id)) }
  })

  app.post('/api/agent/computers/:id/pairings', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    if (!await computersFeatureEnabled()) throw new AppError(403, 'computers_disabled', 'Running the agent on personal computers is turned off for this instance')
    const sessionId = await requiredSessionId(request, user.id)
    const pairing = await requestPairing(user.id, sessionId, id, resolveClientIp(request.raw, getConfig()) ?? null)
    reply.code(pairing.status === 'pending' ? 202 : 200)
    return { pairing }
  })

  for (const decision of ['approve', 'deny'] as const) {
    app.post(`/api/agent/computers/:id/pairings/:pairingId/${decision}`, async (request) => {
      const user = requireUser(request)
      const { pairingId } = request.params as { id: string; pairingId: string }
      const sessionId = await requiredSessionId(request, user.id)
      return { pairing: await decidePairing({ pairingId, approved: decision === 'approve', userId: user.id, actorSessionId: sessionId, requireOwner: true }) }
    })
  }

  app.delete('/api/agent/computers/:id/pairings/:pairingId', async (request, reply) => {
    const user = requireUser(request)
    const { pairingId } = request.params as { id: string; pairingId: string }
    await revokePairing(user.id, await requiredSessionId(request, user.id), pairingId)
    reply.code(204)
    return null
  })

  app.get('/api/agent/approvals', async (request) => {
    const user = requireUser(request)
    return { approvals: await listPendingApprovals(user.id) }
  })

  for (const decision of ['approve', 'deny'] as const) {
    app.post(`/api/agent/approvals/:id/${decision}`, async (request) => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const sessionId = await optionalSessionId(request, user.id)
      const result = await decideToolApproval({ approvalId: id, approved: decision === 'approve', userId: user.id, sessionId, via: 'chat' })
      return { approval: { id: result.row.id, status: result.row.status } }
    })
  }
}
