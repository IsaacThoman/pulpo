import { createHash, timingSafeEqual } from 'node:crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  computerChatAttachmentsDirectory, computerAccessModeSchema, computerApprovalPolicySchema, computerOsSchema, computerShellSchema,
  type AgentComputer, type ComputerAnnounce, type ComputerPairingStatus, type ComputerWorkspaceDescriptor, type UpdateAgentComputerInput,
} from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { agentComputerPairings, agentComputers, agentToolApprovals, auditEvents, users, workspaceLeases, sessions, responses } from '../../database/schema.js'
import { AppError, notFound } from '../../lib/errors.js'
import { newId } from '../../lib/ids.js'
import { publishStateChange, requestCancellation } from '../../responses/events.js'
import { onlineComputerIds } from './presence.js'
import { clearPairingCode } from './pairing-codes.js'
import { publishComputerEvent } from './rpc.js'

export type ComputerRow = typeof agentComputers.$inferSelect

export async function recordComputerAudit(actorUserId: string | null, action: string, computerId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await db.insert(auditEvents).values({ id: newId(), actorUserId, action, targetType: 'agent_computer', targetId: computerId, metadata })
}

/** Bump the account revision so every client refetches its computer list. */
export async function bumpComputersRevision(userId: string): Promise<void> {
  const [row] = await db.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` }).where(eq(users.id, userId)).returning({ revision: users.stateRevision })
  if (row) await publishStateChange({ userId, revision: row.revision, scopes: ['computers'] })
}

export function computerDescriptor(row: ComputerRow, chatId: string): ComputerWorkspaceDescriptor {
  return {
    kind: 'computer',
    computerId: row.id,
    computerName: row.name,
    os: computerOsSchema.parse(row.os),
    accessMode: computerAccessModeSchema.parse(row.accessMode),
    root: row.rootPath,
    attachmentsDir: computerChatAttachmentsDirectory(row.attachmentsDir, chatId, computerOsSchema.parse(row.os)),
    homeDir: row.homeDir,
    shell: computerShellSchema.parse(row.shell),
    approvalPolicy: computerApprovalPolicySchema.parse(row.approvalPolicy),
  }
}

/** Called on every desktop connection: creates or refreshes the row and binds it to the connecting session. */
export async function registerComputer(userId: string, sessionId: string, announce: ComputerAnnounce, deviceSecret: string): Promise<ComputerRow> {
  if (!/^[a-f0-9]{64}$/.test(deviceSecret)) throw new AppError(403, 'computer_credential_required', 'Update the desktop app to register this computer')
  const credentialHash = createHash('sha256').update(deviceSecret).digest('hex')
  let ownershipChanged = false
  let created = false
  const registered = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(agentComputers).where(eq(agentComputers.id, announce.computerId)).limit(1).for('update')
    if (existing && !computerCredentialMatches(existing, sessionId, credentialHash)) throw new AppError(403, 'computer_credential_invalid', 'This installation cannot claim that computer')
    if (existing && existing.userId !== userId) throw new AppError(403, 'computer_owner_mismatch', 'This computer is registered to a different account')
    if (existing?.revokedAt) throw new AppError(403, 'computer_revoked', 'This computer was removed from the account. Re-enable it from the desktop app to register it again.')
    created = !existing
    ownershipChanged = Boolean(existing && existing.ownerSessionId !== sessionId)
    const now = new Date()
    const values = {
      userId, credentialHash, ownerSessionId: sessionId, name: announce.name, os: announce.os, arch: announce.arch, appVersion: announce.appVersion,
      accessMode: announce.accessMode, rootPath: announce.rootPath, attachmentsDir: announce.attachmentsDir, homeDir: announce.homeDir,
      shell: announce.shell, approvalPolicy: announce.approvalPolicy, allowRemote: announce.allowRemote, enabled: true, lastSeenAt: now, updatedAt: now,
    }
    const [row] = existing
      ? await tx.update(agentComputers).set(values).where(eq(agentComputers.id, announce.computerId)).returning()
      : await tx.insert(agentComputers).values({ id: announce.computerId, ...values }).returning()
    if (!row) throw new Error('Unable to register computer')
    return row
  })
  if (created) await recordComputerAudit(userId, 'computer.registered', registered.id, { name: registered.name, os: registered.os })
  if (ownershipChanged || !announce.allowRemote) await revokeAllPairings(registered.id, sessionId, ownershipChanged ? 'owner_changed' : 'remote_disabled')
  return registered
}

/** Owner-driven change from the shared settings UI. The desktop mirrors it into its local config. */
export async function updateComputer(userId: string, sessionId: string, computerId: string, patch: UpdateAgentComputerInput): Promise<ComputerRow> {
  const [existing] = await db.select().from(agentComputers).where(and(eq(agentComputers.id, computerId), eq(agentComputers.userId, userId), isNull(agentComputers.revokedAt))).limit(1)
  if (!existing) throw notFound('Computer')
  if (existing.ownerSessionId !== sessionId) throw new AppError(403, 'computer_owner_only', 'Only the desktop app that registered this computer can change its settings')
  const [row] = await db.update(agentComputers).set({ ...patch, updatedAt: new Date() }).where(eq(agentComputers.id, computerId)).returning()
  if (!row) throw notFound('Computer')
  if (existing.allowRemote && patch.allowRemote === false) await revokeAllPairings(computerId, sessionId, 'remote_disabled')
  if (existing.enabled && patch.enabled === false) await disableComputerSideEffects(row, sessionId, 'disabled')
  await recordComputerAudit(userId, 'computer.updated', computerId, patch as Record<string, unknown>)
  await bumpComputersRevision(userId)
  return row
}

export async function revokeAllPairings(computerId: string, actorSessionId: string | null, reason: string): Promise<void> {
  await clearPairingCode(computerId)
  const revoked = await db.update(agentComputerPairings).set({ status: 'revoked', decidedAt: new Date(), decidedBySessionId: actorSessionId, updatedAt: new Date() })
    .where(and(eq(agentComputerPairings.computerId, computerId), inArray(agentComputerPairings.status, ['pending', 'approved']))).returning({ id: agentComputerPairings.id, sessionId: agentComputerPairings.deviceSessionId })
  for (const pairing of revoked) await revokeComputerSession(computerId, pairing.sessionId)
  if (revoked.length) {
    const [computer] = await db.select({ userId: agentComputers.userId }).from(agentComputers).where(eq(agentComputers.id, computerId)).limit(1)
    if (computer) await recordComputerAudit(computer.userId, 'computer.pairings.revoked', computerId, { reason, count: revoked.length })
  }
}

/** Expire leases, cancel pending approvals, and tell the desktop to stop. */
async function disableComputerSideEffects(row: ComputerRow, actorSessionId: string | null, reason: 'disabled' | 'deleted' | 'session_revoked'): Promise<void> {
  const now = new Date()
  await db.update(workspaceLeases).set({ status: 'expired', error: `Computer ${reason}`, updatedAt: now })
    .where(and(eq(workspaceLeases.computerId, row.id), inArray(workspaceLeases.status, ['provisioning', 'ready'])))
  await db.update(agentToolApprovals).set({ status: 'cancelled', decidedAt: now, decidedBySessionId: actorSessionId, updatedAt: now })
    .where(and(eq(agentToolApprovals.computerId, row.id), eq(agentToolApprovals.status, 'pending')))
  await publishComputerEvent(row.id, 'computer.revoked', { reason })
}

export async function revokeComputer(userId: string, sessionId: string | null, computerId: string): Promise<void> {
  const [existing] = await db.select().from(agentComputers).where(and(eq(agentComputers.id, computerId), eq(agentComputers.userId, userId))).limit(1)
  if (!existing) throw notFound('Computer')
  if (existing.revokedAt) return
  await db.update(agentComputers).set({ enabled: false, allowRemote: false, revokedAt: new Date(), updatedAt: new Date() }).where(eq(agentComputers.id, computerId))
  await revokeAllPairings(computerId, sessionId, 'computer_deleted')
  await disableComputerSideEffects(existing, sessionId, 'deleted')
  await recordComputerAudit(userId, 'computer.revoked', computerId, {})
  await bumpComputersRevision(userId)
}

export async function loadComputer(computerId: string): Promise<ComputerRow | undefined> {
  const [row] = await db.select().from(agentComputers).where(eq(agentComputers.id, computerId)).limit(1)
  return row
}

/** A computer the worker may run tools on right now: registered, enabled, not revoked. Presence is checked separately. */
export async function loadRunnableComputer(computerId: string): Promise<ComputerRow> {
  const row = await loadComputer(computerId)
  if (!row || row.revokedAt) throw new AppError(410, 'computer_unavailable', 'The selected computer was removed from this account')
  if (!row.enabled) throw new AppError(409, 'computer_disabled', `${row.name} has agent access turned off`)
  return row
}

/**
 * Whether a device session may select the computer as its workspace: the owning desktop session
 * always may; any other session needs an approved pairing while remote access stays enabled.
 */
export async function assertComputerUsable(userId: string, sessionId: string, computerId: string): Promise<ComputerRow> {
  const [session] = await db.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId))).limit(1)
  if (!session || session.expiresAt.getTime() <= Date.now()) throw new AppError(403, 'computer_session_required', 'Sign in again to use this computer')
  const [row] = await db.select().from(agentComputers).where(and(eq(agentComputers.id, computerId), eq(agentComputers.userId, userId))).limit(1)
  if (!row || row.revokedAt) throw notFound('Computer')
  if (!row.enabled) throw new AppError(409, 'computer_disabled', `${row.name} has agent access turned off`)
  if (row.ownerSessionId === sessionId) return row
  if (!row.allowRemote) throw new AppError(403, 'computer_remote_disabled', `${row.name} does not allow other devices to use it`)
  const [pairing] = await db.select({ id: agentComputerPairings.id }).from(agentComputerPairings).where(and(
    eq(agentComputerPairings.computerId, computerId), eq(agentComputerPairings.deviceSessionId, sessionId), eq(agentComputerPairings.status, 'approved'),
  )).limit(1)
  if (!pairing) throw new AppError(403, 'computer_pairing_required', `Pair this device with ${row.name} before selecting it`)
  return row
}

export async function listComputers(userId: string, sessionId: string | null): Promise<AgentComputer[]> {
  const rows = await db.select().from(agentComputers).where(and(eq(agentComputers.userId, userId), isNull(agentComputers.revokedAt))).orderBy(agentComputers.createdAt)
  if (!rows.length) return []
  const online = await onlineComputerIds(rows.map((row) => row.id))
  const pairings = sessionId
    ? await db.select().from(agentComputerPairings).where(and(
      eq(agentComputerPairings.deviceSessionId, sessionId), inArray(agentComputerPairings.computerId, rows.map((row) => row.id)), inArray(agentComputerPairings.status, ['pending', 'approved']),
    ))
    : []
  const pairingByComputer = new Map(pairings.map((pairing) => [pairing.computerId, pairing]))
  return rows.map((row) => {
    const owned = Boolean(sessionId) && row.ownerSessionId === sessionId
    const pairing = pairingByComputer.get(row.id)
    return {
      id: row.id, name: row.name, os: computerOsSchema.parse(row.os), arch: row.arch, appVersion: row.appVersion,
      accessMode: computerAccessModeSchema.parse(row.accessMode), rootPath: row.rootPath,
      approvalPolicy: computerApprovalPolicySchema.parse(row.approvalPolicy), allowRemote: row.allowRemote, enabled: row.enabled,
      online: online.has(row.id), isOwnedByThisDevice: owned,
      pairing: owned || !pairing ? null : { id: pairing.id, status: pairing.status as ComputerPairingStatus },
      selectable: row.enabled && online.has(row.id) && (owned || (row.allowRemote && pairing?.status === 'approved')),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
    }
  })
}

/** Desktop sessions that sign out or get revoked take their computers offline and drop their pairings. */
export async function detachComputersFromSessions(sessionIds: string[]): Promise<void> {
  if (!sessionIds.length) return
  const paired = await db.select().from(agentComputerPairings).where(inArray(agentComputerPairings.deviceSessionId, sessionIds))
  for (const pairing of paired) await revokeComputerSession(pairing.computerId, pairing.deviceSessionId)
  const owned = await db.select().from(agentComputers).where(inArray(agentComputers.ownerSessionId, sessionIds))
  for (const row of owned) {
    await revokeAllPairings(row.id, null, 'session_revoked')
    await db.update(agentComputers).set({ ownerSessionId: null, updatedAt: new Date() }).where(eq(agentComputers.id, row.id))
    await disableComputerSideEffects(row, null, 'session_revoked')
  }
}

export function computerCredentialMatches(existing: Pick<ComputerRow, 'credentialHash' | 'ownerSessionId'>, sessionId: string, hash: string): boolean {
  if (!existing.credentialHash) return existing.ownerSessionId === sessionId
  const expected = Buffer.from(existing.credentialHash, 'hex')
  const actual = Buffer.from(hash, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Stop this session's accepted work as well as refusing its next request. */
export async function revokeComputerSession(computerId: string, sessionId: string): Promise<void> {
  const affected = await db.select({ id: responses.id }).from(responses).where(and(eq(responses.workspaceComputerId, computerId), eq(responses.requesterSessionId, sessionId), inArray(responses.status, ['queued', 'in_progress'])))
  await Promise.all(affected.map((row) => requestCancellation(row.id)))
  if (affected.length) await db.update(agentToolApprovals).set({ status: 'cancelled', decidedAt: new Date(), updatedAt: new Date() }).where(and(inArray(agentToolApprovals.responseId, affected.map((row) => row.id)), eq(agentToolApprovals.status, 'pending')))
  await publishComputerEvent(computerId, 'computer.access.revoked', { sessionId })
}

/** Reauthorize every relayed request against the persisted response destination and session. */
export async function authorizeComputerRequest(computerId: string, request: { kind?: string; chatId: string; responseId?: string; requesterSessionId?: string }): Promise<void> {
  if (!request.responseId || !request.requesterSessionId) throw new Error('Computer request is missing its originating session')
  const [response] = await db.select({ userId: responses.userId, chatId: responses.chatId, workspaceComputerId: responses.workspaceComputerId, requesterSessionId: responses.requesterSessionId, status: responses.status }).from(responses).where(eq(responses.id, request.responseId)).limit(1)
  if (!response || response.chatId !== request.chatId || response.workspaceComputerId !== computerId || response.requesterSessionId !== request.requesterSessionId || (request.kind !== 'operation.cancel' && !['queued', 'in_progress'].includes(response.status))) throw new Error('This response no longer has access to the computer')
  await assertComputerUsable(response.userId, request.requesterSessionId, computerId)
}
