import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import {
  computerActionPayload, TOOL_APPROVAL_SUMMARY_MAX_CHARACTERS, TOOL_APPROVAL_TIMEOUT_MS,
  type ToolApproval, type ToolApprovalDecisionSource, type ToolApprovalItem, type ToolApprovalKind, type ToolApprovalStatus,
} from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { agentComputers, agentToolApprovals, responses } from '../../database/schema.js'
import { AppError, notFound } from '../../lib/errors.js'
import { newId } from '../../lib/ids.js'
import { publishComputerEvent } from './rpc.js'
import { recordComputerAudit } from './registry.js'

export type ApprovalRow = typeof agentToolApprovals.$inferSelect

/** What the user sees before deciding: the command for shell, the target path for writes. */
export function toolApprovalSummary(type: string, args: Record<string, unknown>): string {
  const raw = type === 'bash' ? String(args.command ?? '') : String(args.path ?? '')
  return raw.length > TOOL_APPROVAL_SUMMARY_MAX_CHARACTERS ? `${raw.slice(0, TOOL_APPROVAL_SUMMARY_MAX_CHARACTERS)}…` : raw
}

export function toolApprovalItem(row: ApprovalRow, computerName: string): ToolApprovalItem {
  return {
    id: row.id, type: 'pulpo_approval', tool_call_id: row.operationId, kind: row.kind as ToolApprovalKind, summary: row.summary,
    status: row.status as ToolApprovalStatus, computer_name: computerName, expires_at: row.expiresAt.toISOString(),
    ...(row.decidedAt ? { decided_at: row.decidedAt.toISOString() } : {}),
    ...(row.decidedVia ? { decided_via: row.decidedVia as ToolApprovalDecisionSource } : {}),
  }
}

export function serializeToolApproval(row: ApprovalRow, computerName: string, chatId: string): ToolApproval {
  return {
    id: row.id, responseId: row.responseId, chatId, computerId: row.computerId, computerName, toolCallId: row.operationId,
    kind: row.kind as ToolApprovalKind, summary: row.summary, status: row.status as ToolApprovalStatus,
    expiresAt: row.expiresAt.toISOString(), decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedVia: (row.decidedVia as ToolApprovalDecisionSource | null) ?? null, createdAt: row.createdAt.toISOString(),
  }
}

export async function createToolApproval(input: {
  responseId: string
  chatId: string
  agentRunId: string
  computerId: string
  computerName: string
  operationId: string
  kind: ToolApprovalKind
  summary: string
  args: Record<string, unknown>
  context: { computerId: string; root: string; accessMode: string }
}): Promise<ApprovalRow> {
  const [existing] = await db.select().from(agentToolApprovals).where(eq(agentToolApprovals.operationId, input.operationId)).limit(1)
  const actionDigest = createHash('sha256').update(computerActionPayload(input.chatId, input.operationId, input.kind, input.args, input.context)).digest('hex')
  if (existing) {
    if (existing.responseId !== input.responseId || existing.computerId !== input.computerId || existing.actionDigest !== actionDigest) throw new Error('Approval retry changed the action; request a new operation')
    return existing
  }
  const [row] = await db.insert(agentToolApprovals).values({
    id: newId(), responseId: input.responseId, agentRunId: input.agentRunId, computerId: input.computerId, operationId: input.operationId,
    actionDigest, kind: input.kind, summary: input.summary, status: 'pending', expiresAt: new Date(Date.now() + TOOL_APPROVAL_TIMEOUT_MS),
  }).onConflictDoNothing().returning()
  const created = row ?? (await db.select().from(agentToolApprovals).where(eq(agentToolApprovals.operationId, input.operationId)).limit(1))[0]
  if (!created) throw new Error('Unable to record approval request')
  await publishComputerEvent(input.computerId, 'computer.approval.requested', serializeToolApproval(created, input.computerName, input.chatId))
  return created
}

export type ApprovalOutcome = Extract<ToolApprovalStatus, 'approved' | 'denied' | 'expired' | 'cancelled'>

/**
 * Block until the approval row leaves `pending`. Polls the database (like the capacity wait) so the
 * decision survives worker restarts and API/worker process boundaries. Expiry is enforced here.
 */
export async function waitForToolApproval(approvalId: string, options: { signal?: AbortSignal; responseId: string; pollMs?: number } = { responseId: '' }): Promise<{ outcome: ApprovalOutcome; row: ApprovalRow }> {
  const pollMs = options.pollMs ?? 1_000
  for (;;) {
    if (options.signal?.aborted) {
      const row = await settleApproval(approvalId, 'cancelled')
      return { outcome: 'cancelled', row }
    }
    const [row] = await db.select().from(agentToolApprovals).where(eq(agentToolApprovals.id, approvalId)).limit(1)
    if (!row) throw new Error('Approval request disappeared')
    if (row.status !== 'pending') return { outcome: row.status as ApprovalOutcome, row }
    if (row.expiresAt.getTime() <= Date.now()) return { outcome: 'expired', row: await settleApproval(approvalId, 'expired') }
    if (options.responseId) {
      const [response] = await db.select({ status: responses.status }).from(responses).where(eq(responses.id, options.responseId)).limit(1)
      if (!response || response.status === 'cancelled') return { outcome: 'cancelled', row: await settleApproval(approvalId, 'cancelled') }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

async function settleApproval(approvalId: string, status: 'expired' | 'cancelled'): Promise<ApprovalRow> {
  const now = new Date()
  const [updated] = await db.update(agentToolApprovals).set({ status, decidedAt: now, updatedAt: now })
    .where(and(eq(agentToolApprovals.id, approvalId), eq(agentToolApprovals.status, 'pending'))).returning()
  const row = updated ?? (await db.select().from(agentToolApprovals).where(eq(agentToolApprovals.id, approvalId)).limit(1))[0]
  if (!row) throw new Error('Approval request disappeared')
  await publishComputerEvent(row.computerId, 'computer.approval.decided', { approvalId, status: row.status })
  return row
}

/** Record a user's decision. Callers must already have verified the caller may act on this response. */
export async function decideToolApproval(input: {
  approvalId: string
  approved: boolean
  userId: string
  sessionId: string | null
  via: ToolApprovalDecisionSource
  /** When set, the approval must belong to this computer (desktop socket decisions). */
  computerId?: string
}): Promise<{ row: ApprovalRow; computerName: string; chatId: string }> {
  const [loaded] = await db.select({ approval: agentToolApprovals, computer: agentComputers, response: { userId: responses.userId, chatId: responses.chatId } })
    .from(agentToolApprovals)
    .innerJoin(agentComputers, eq(agentComputers.id, agentToolApprovals.computerId))
    .innerJoin(responses, eq(responses.id, agentToolApprovals.responseId))
    .where(eq(agentToolApprovals.id, input.approvalId)).limit(1)
  if (!loaded || loaded.response.userId !== input.userId) throw notFound('Approval request')
  if (input.computerId && loaded.approval.computerId !== input.computerId) throw notFound('Approval request')
  if (loaded.approval.status !== 'pending') throw new AppError(409, 'approval_already_decided', 'This request was already decided')
  if (loaded.approval.expiresAt.getTime() <= Date.now()) {
    await settleApproval(input.approvalId, 'expired')
    throw new AppError(409, 'approval_expired', 'This request expired before it was decided')
  }
  const status: ToolApprovalStatus = input.approved ? 'approved' : 'denied'
  const now = new Date()
  const [row] = await db.update(agentToolApprovals).set({ status, decidedAt: now, decidedBySessionId: input.sessionId, decidedVia: input.via, updatedAt: now })
    .where(and(eq(agentToolApprovals.id, input.approvalId), eq(agentToolApprovals.status, 'pending'))).returning()
  if (!row) throw new AppError(409, 'approval_already_decided', 'This request was already decided')
  await recordComputerAudit(input.userId, `computer.approval.${status}`, row.computerId, { approvalId: row.id, kind: row.kind, via: input.via, responseId: row.responseId })
  await publishComputerEvent(row.computerId, 'computer.approval.decided', { approvalId: row.id, status })
  return { row, computerName: loaded.computer.name, chatId: loaded.response.chatId }
}

export async function listPendingApprovals(userId: string): Promise<ToolApproval[]> {
  const rows = await db.select({ approval: agentToolApprovals, computer: agentComputers, response: { chatId: responses.chatId } })
    .from(agentToolApprovals)
    .innerJoin(agentComputers, eq(agentComputers.id, agentToolApprovals.computerId))
    .innerJoin(responses, eq(responses.id, agentToolApprovals.responseId))
    .where(and(eq(responses.userId, userId), eq(agentToolApprovals.status, 'pending')))
  return rows.map((row) => serializeToolApproval(row.approval, row.computer.name, row.response.chatId))
}

/** Desktop verification is durable and bound to the complete action, never a reusable bare ID. */
export async function verifyToolApproval(computerId: string, input: { approvalId: string; chatId: string; operationId: string; digest: string }): Promise<boolean> {
  const [loaded] = await db.select({ approval: agentToolApprovals, chatId: responses.chatId }).from(agentToolApprovals)
    .innerJoin(responses, eq(responses.id, agentToolApprovals.responseId))
    .where(and(eq(agentToolApprovals.id, input.approvalId), eq(agentToolApprovals.computerId, computerId))).limit(1)
  return Boolean(loaded && loaded.chatId === input.chatId && loaded.approval.operationId === input.operationId && loaded.approval.status === 'approved' && loaded.approval.actionDigest === input.digest)
}
