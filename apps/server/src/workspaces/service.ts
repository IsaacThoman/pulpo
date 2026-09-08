import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { resolveWorkspace, WORKSPACE_UNRESPONSIVE_MS, type WorkspaceSelection } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { sessions, users, workspaceComputers, responses } from '../database/schema.js'
import { AppError } from '../lib/errors.js'

export const credentialHash = (value: string) => createHash('sha256').update(value).digest('hex')
export const deviceCredential = () => randomBytes(32).toString('base64url')
export async function authorizedComputer(token: string) {
  const [row] = await db.select({ computer: workspaceComputers }).from(workspaceComputers)
    .innerJoin(sessions, eq(workspaceComputers.sessionId, sessions.id))
    .innerJoin(users, eq(workspaceComputers.userId, users.id))
    .where(and(eq(workspaceComputers.tokenHash, credentialHash(token)), isNull(workspaceComputers.revokedAt), gt(sessions.expiresAt, new Date()), eq(users.blocked, false))).limit(1)
  return row?.computer
}
export async function validateWorkspace(userId: string, value: WorkspaceSelection | null | undefined, agentMode = false) {
  const selection = resolveWorkspace(value, agentMode)
  if (selection.kind === 'computer') {
    const [row] = await db.select({ computer: workspaceComputers }).from(workspaceComputers)
      .innerJoin(sessions, eq(sessions.id, workspaceComputers.sessionId))
      .where(and(eq(workspaceComputers.id, selection.deviceId), eq(workspaceComputers.userId, userId), isNull(workspaceComputers.revokedAt), gt(sessions.expiresAt, new Date()))).limit(1)
    if (!row?.computer.registration.roots.some(root => root.id === selection.rootId)) throw new AppError(400, 'workspace_unavailable', 'This computer or working folder is no longer authorized')
  }
  return selection
}
export async function listComputers(userId: string) {
  const rows = await db.select({ computer: workspaceComputers }).from(workspaceComputers)
    .innerJoin(sessions, eq(sessions.id, workspaceComputers.sessionId))
    .where(and(eq(workspaceComputers.userId, userId), isNull(workspaceComputers.revokedAt), gt(sessions.expiresAt, new Date())))
  return rows.map(({ computer }) => ({ id: computer.id, ...computer.registration, online: !!computer.lastSeenAt && Date.now() - computer.lastSeenAt.getTime() < WORKSPACE_UNRESPONSIVE_MS }))
}
/** Transaction locks also serialize recovery requests arriving through different API replicas. */
export const responseLock = (id: string) => sql`select pg_advisory_xact_lock(hashtext(${`workspace:${id}`}))`

/** Serialize expiry with Keep waiting so a successful renewal cannot be expired by a stale read. */
export async function claimWorkspaceExpiry(responseId: string, generation: number): Promise<boolean> {
  return db.transaction(async tx => {
    await tx.execute(responseLock(responseId))
    const [row] = await tx.select().from(responses).where(and(eq(responses.id, responseId), eq(responses.workspaceGeneration, generation), eq(responses.status, 'in_progress'))).limit(1)
    if (!row?.workspaceWait || Date.parse(row.workspaceWait.deadline) > Date.now()) return false
    await tx.update(responses).set({ status: 'failed', error: { message: 'Workspace waiting deadline expired. Retry or choose another workspace.' }, completedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, responseId))
    return true
  })
}
