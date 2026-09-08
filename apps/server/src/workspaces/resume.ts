import { isCancellationRequested } from '../responses/events.js'
import { and, eq, inArray } from 'drizzle-orm'
import { WORKSPACE_UNRESPONSIVE_MS } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { responses, agentRuns, workspaceOperations } from '../database/schema.js'
import { generationQueue } from '../jobs.js'

export async function workspaceCanResume(responseId: string): Promise<boolean> {
  const [response] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
  if (!response?.workspaceWait || await isCancellationRequested(responseId)) return true
  if (Date.parse(response.workspaceWait.deadline) <= Date.now()) return true
  if (response.workspaceWait.workspace.kind === 'pulpo') return true
  const [op] = await db.select().from(workspaceOperations).where(and(eq(workspaceOperations.responseId, responseId), eq(workspaceOperations.generation, response.workspaceGeneration), eq(workspaceOperations.operationId, response.workspaceWait.operationId ?? ''))).limit(1)
  return !!op?.result && op.result.status !== 'unknown' && (!!op.lastSeenAt && Date.now() - op.lastSeenAt.getTime() < WORKSPACE_UNRESPONSIVE_MS || op.result.status !== 'running')
}
let checking = false
export async function resumeWorkspaceResponses() {
  if (checking) return
  checking = true
  try {
    const rows = await db.select({ response: responses, context: agentRuns.context }).from(responses).innerJoin(agentRuns, eq(agentRuns.responseId, responses.id))
      .where(inArray(responses.status, ['in_progress']))
    for (const { response, context } of rows) {
      if (!(context as { suspended?: boolean }).suspended || !await workspaceCanResume(response.id)) continue
      await generationQueue.add('workspace-resume', { responseId: response.id }, { jobId: `workspace-${response.id}-${response.workspaceGeneration}-${response.updatedAt.getTime()}`, removeOnComplete: true, removeOnFail: true })
    }
  } finally { checking = false }
}
