import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  computerAccessModeSchema, computerApprovalPolicySchema, computerOsSchema, computerShellSchema,
  type AgentComputer, type ComputerAnnounce, type ComputerPairingStatus, type ComputerWorkspaceDescriptor, type UpdateAgentComputerInput,
} from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { agentComputerPairings, agentComputers, agentToolApprovals, auditEvents, users, workspaceLeases } from '../../database/schema.js'
import { AppError, notFound } from '../../lib/errors.js'
import { newId } from '../../lib/ids.js'
import { publishStateChange } from '../../responses/events.js'
import { onlineComputerIds } from './presence.js'
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

export function computerDescriptor(row: ComputerRow): ComputerWorkspaceDescriptor {
  return {
    kind: 'computer',
    computerId: row.id,
    computerName: row.name,
    os: computerOsSchema.parse(row.os),
    accessMode: computerAccessModeSchema.parse(row.accessMode),
    root: row.rootPath,
    attachmentsDir: row.attachmentsDir,
    homeDir: row.homeDir,
    shell: computerShellSchema.parse(row.shell),
    approvalPolicy: computerApprovalPolicySchema.parse(row.approvalPolicy),
  }
}

/** Called on every desktop connection: creates or refreshes the row and binds it to the connecting session. */
export async function registerComputer(userId: string, sessionId: string, announce: ComputerAnnounce): Promise<ComputerRow> {
  const [existing] = await db.select().from(agentComputers).where(eq(agentComputers.id, announce.computerId)).limit(1)
  if (existing && existing.userId !== userId) throw new AppError(403, 'computer_owner_mismatch', 'This computer is registered to a different account')
  if (existing?.revokedAt) throw new AppError(403, 'computer_revoked', 'This computer was removed from the account. Re-enable it from the desktop app to register it again.')
  const now = new Date()
  const values = {
    userId, ownerSessionId: sessionId, name: announce.name, os: announce.os, arch: announce.arch, appVersion: announce.appVersion,
    accessMode: announce.accessMode, rootPath: announce.rootPath, attachmentsDir: announce.attachmentsDir, homeDir: announce.homeDir,
    shell: announce.shell, approvalPolicy: announce.approvalPolicy, allowRemote: announce.allowRemote, enabled: true, lastSeenAt: now, updatedAt: now,
  }
  const [row] = existing
    ? await db.update(agentComputers).set(values).where(eq(agentComputers.id, announce.computerId)).returning()
    : await db.insert(agentComputers).values({ id: announce.computerId, ...values }).returning()
  if (!row) throw new Error('Unable to register computer')
  if (!existing) await recordComputerAudit(userId, 'computer.registered', row.id, { name: row.name, os: row.os })
  else if (existing.allowRemote && !announce.allowRemote) await revokeAllPairings(row.id, sessionId, 'remote_disabled')
  return row
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

async function revokeAllPairings(computerId: string, actorSessionId: string | null, reason: string): Promise<void> {
  const revoked = await db.update(agentComputerPairings).set({ status: 'revoked', decidedAt: new Date(), decidedBySessionId: actorSessionId, updatedAt: new Date() })
    .where(and(eq(agentComputerPairings.computerId, computerId), inArray(agentComputerPairings.status, ['pending', 'approved']))).returning({ id: agentComputerPairings.id })
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

/** Let the desktop re-register after the user removed and re-enabled the same computer id. */
export async function clearComputerRevocation(userId: string, computerId: string): Promise<void> {
  await db.update(agentComputers).set({ revokedAt: null, updatedAt: new Date() }).where(and(eq(agentComputers.id, computerId), eq(agentComputers.userId, userId)))
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
  const owned = await db.select().from(agentComputers).where(inArray(agentComputers.ownerSessionId, sessionIds))
  for (const row of owned) {
    await db.update(agentComputers).set({ ownerSessionId: null, updatedAt: new Date() }).where(eq(agentComputers.id, row.id))
    await disableComputerSideEffects(row, null, 'session_revoked')
  }
}
