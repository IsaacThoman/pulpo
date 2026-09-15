import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { db } from '../database/client.js'
import { requestLogs, responses, workspaceLeases } from '../database/schema.js'
import { getConfig } from '../config.js'
import { workspaceControllerRequest } from './controller-http.js'

async function releaseLease(lease: { id: string; controllerLeaseId: string | null }): Promise<void> {
  try {
    if (lease.controllerLeaseId) {
      const config = getConfig()
      if (!config.WORKSPACE_CONTROLLER_URL || !config.WORKSPACE_CONTROLLER_TOKEN) return
      const response = await workspaceControllerRequest(`/v1/leases/${lease.controllerLeaseId}`, {
        method: 'DELETE', signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok && response.status !== 404) throw new Error(`Workspace release failed (${response.status})`)
    }
    const now = new Date()
    await db.update(workspaceLeases).set({ status: 'released', capacityState: null, releasedAt: now, updatedAt: now })
      .where(eq(workspaceLeases.id, lease.id))
  } catch (error) {
    // Keep the row unreleased so maintenance can retry. Never fail a completed answer.
    console.warn(JSON.stringify({ event: 'workspace.release_failed', leaseId: lease.id, error: error instanceof Error ? error.message : String(error) }))
  }
}

export async function releaseWorkspaceForResponse(responseId: string): Promise<void> {
  const leases = await db.select().from(workspaceLeases)
    .where(and(eq(workspaceLeases.responseId, responseId), isNull(workspaceLeases.releasedAt)))
  await Promise.all(leases.map(releaseLease))
}

export async function releaseWorkspaceForChat(chatId: string): Promise<void> {
  const leases = await db.select().from(workspaceLeases)
    .where(and(eq(workspaceLeases.chatId, chatId), isNull(workspaceLeases.releasedAt)))
  await Promise.all(leases.map(releaseLease))
}

/** Recover missed cleanup after a worker exits or the controller was unreachable. */
export async function releaseFinishedWorkspaces(): Promise<void> {
  const leases = await db.select({ id: workspaceLeases.id, controllerLeaseId: workspaceLeases.controllerLeaseId })
    .from(workspaceLeases)
    .leftJoin(responses, eq(responses.id, workspaceLeases.responseId))
    .leftJoin(requestLogs, eq(requestLogs.responseId, responses.id))
    .where(and(isNull(workspaceLeases.releasedAt), or(
      isNull(workspaceLeases.responseId),
      and(inArray(responses.status, ['completed', 'failed', 'cancelled', 'incomplete']), isNotNull(requestLogs.completedAt)),
    ))).limit(50)
  await Promise.all(leases.map(releaseLease))
}
