import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../database/client.js'
import { agentRuns, toolExecutions, workspaceLeases, workspaceOperations } from '../database/schema.js'
import { workspaceControllerRequest } from '../agent/controller-http.js'

/** Cancellation is a request; an unavailable workspace may still finish the command. */
export async function cancelManagedOperations(responseId: string) {
  const rows = await db.select({ operationId: toolExecutions.operationId, controllerLeaseId: workspaceLeases.controllerLeaseId }).from(toolExecutions)
    .innerJoin(agentRuns, eq(toolExecutions.agentRunId, agentRuns.id))
    .innerJoin(workspaceLeases, eq(toolExecutions.workspaceLeaseId, workspaceLeases.id))
    .where(and(eq(agentRuns.responseId, responseId), inArray(toolExecutions.status, ['queued', 'running'])))
  await Promise.all(rows.filter(row => row.controllerLeaseId).map(row => workspaceControllerRequest(`/v1/leases/${row.controllerLeaseId}/v1/operations/${encodeURIComponent(row.operationId)}/cancel`, { method: 'POST', signal: AbortSignal.timeout(2000) }).catch(() => undefined)))
}
export async function retireWorkspaceOperations(responseId: string, generation: number) {
  await db.update(workspaceOperations).set({ retiredAt: new Date(), cancelRequested: true }).where(and(eq(workspaceOperations.responseId, responseId), eq(workspaceOperations.generation, generation)))
  await cancelManagedOperations(responseId)
}
