import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import type { ComputerPairing, ComputerPairingStatus } from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { agentComputerPairings, agentComputers, sessions } from '../../database/schema.js'
import { serializeDeviceSession } from '../../auth/device-sessions.js'
import { AppError, notFound } from '../../lib/errors.js'
import { newId } from '../../lib/ids.js'
import { computerIsOnline } from './presence.js'
import { publishComputerEvent } from './rpc.js'
import { bumpComputersRevision, recordComputerAudit, type ComputerRow } from './registry.js'

type PairingRow = typeof agentComputerPairings.$inferSelect
type SessionRow = typeof sessions.$inferSelect

export function serializePairing(pairing: PairingRow, computer: Pick<ComputerRow, 'name'>, session: SessionRow, currentSessionId: string | null): ComputerPairing {
  const device = serializeDeviceSession(session, currentSessionId ?? '')
  return {
    id: pairing.id, computerId: pairing.computerId, computerName: computer.name, status: pairing.status as ComputerPairingStatus,
    deviceSessionId: pairing.deviceSessionId, deviceLabel: device.deviceLabel, appType: device.appType, platform: device.platform, browser: device.browser,
    requestedIp: pairing.requestedIp, requestedAt: pairing.requestedAt.toISOString(), decidedAt: pairing.decidedAt?.toISOString() ?? null,
    isCurrentDevice: pairing.deviceSessionId === currentSessionId,
  }
}

async function loadPairing(pairingId: string): Promise<{ pairing: PairingRow; computer: ComputerRow; session: SessionRow } | undefined> {
  const [row] = await db.select({ pairing: agentComputerPairings, computer: agentComputers, session: sessions })
    .from(agentComputerPairings)
    .innerJoin(agentComputers, eq(agentComputers.id, agentComputerPairings.computerId))
    .innerJoin(sessions, eq(sessions.id, agentComputerPairings.deviceSessionId))
    .where(eq(agentComputerPairings.id, pairingId)).limit(1)
  return row
}

/** A non-owner device asks to use the computer. The owning desktop is prompted to approve. */
export async function requestPairing(userId: string, sessionId: string, computerId: string, requestedIp: string | null): Promise<ComputerPairing> {
  const [computer] = await db.select().from(agentComputers).where(and(eq(agentComputers.id, computerId), eq(agentComputers.userId, userId), isNull(agentComputers.revokedAt))).limit(1)
  if (!computer) throw notFound('Computer')
  if (computer.ownerSessionId === sessionId) throw new AppError(409, 'computer_owner_session', 'This device already owns the computer')
  if (!computer.enabled) throw new AppError(409, 'computer_disabled', `${computer.name} has agent access turned off`)
  if (!computer.allowRemote) throw new AppError(403, 'computer_remote_disabled', `${computer.name} does not allow other devices to use it`)
  if (!await computerIsOnline(computerId)) throw new AppError(409, 'computer_offline', `${computer.name} is offline; open the Pulpo desktop app there first`)
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  if (!session) throw notFound('Session')
  const [existing] = await db.select().from(agentComputerPairings).where(and(
    eq(agentComputerPairings.computerId, computerId), eq(agentComputerPairings.deviceSessionId, sessionId), inArray(agentComputerPairings.status, ['pending', 'approved']),
  )).limit(1)
  let pairing = existing
  if (!pairing) {
    ;[pairing] = await db.insert(agentComputerPairings).values({ id: newId(), computerId, deviceSessionId: sessionId, status: 'pending', requestedIp }).returning()
    if (!pairing) throw new Error('Unable to create pairing request')
    await recordComputerAudit(userId, 'computer.pairing.requested', computerId, { pairingId: pairing.id, deviceSessionId: sessionId })
  }
  const serialized = serializePairing(pairing, computer, session, sessionId)
  if (pairing.status === 'pending') await publishComputerEvent(computerId, 'computer.pairing.requested', { ...serialized, isCurrentDevice: false })
  await bumpComputersRevision(userId)
  return serialized
}

export async function decidePairing(input: { pairingId: string; approved: boolean; userId: string; actorSessionId: string; requireOwner: boolean }): Promise<ComputerPairing> {
  const loaded = await loadPairing(input.pairingId)
  if (!loaded || loaded.computer.userId !== input.userId) throw notFound('Pairing request')
  const { pairing, computer, session } = loaded
  if (input.requireOwner && computer.ownerSessionId !== input.actorSessionId) throw new AppError(403, 'computer_owner_only', 'Only the desktop app that owns this computer can approve pairing requests')
  if (pairing.status !== 'pending') throw new AppError(409, 'pairing_already_decided', 'This pairing request was already decided')
  const status: ComputerPairingStatus = input.approved ? 'approved' : 'denied'
  const [updated] = await db.update(agentComputerPairings).set({ status, decidedAt: new Date(), decidedBySessionId: input.actorSessionId, updatedAt: new Date() })
    .where(and(eq(agentComputerPairings.id, pairing.id), eq(agentComputerPairings.status, 'pending'))).returning()
  if (!updated) throw new AppError(409, 'pairing_already_decided', 'This pairing request was already decided')
  await recordComputerAudit(input.userId, `computer.pairing.${status}`, computer.id, { pairingId: pairing.id, deviceSessionId: pairing.deviceSessionId })
  await publishComputerEvent(computer.id, 'computer.pairing.decided', { pairingId: pairing.id, status })
  await bumpComputersRevision(input.userId)
  return serializePairing(updated, computer, session, input.actorSessionId)
}

/** Either side may end a pairing: the owner from the desktop, or the paired device itself. */
export async function revokePairing(userId: string, actorSessionId: string, pairingId: string): Promise<void> {
  const loaded = await loadPairing(pairingId)
  if (!loaded || loaded.computer.userId !== userId) throw notFound('Pairing')
  const { pairing, computer } = loaded
  const permitted = computer.ownerSessionId === actorSessionId || pairing.deviceSessionId === actorSessionId
  if (!permitted) throw new AppError(403, 'pairing_forbidden', 'Only the owning desktop or the paired device can remove this pairing')
  if (!['pending', 'approved'].includes(pairing.status)) return
  await db.update(agentComputerPairings).set({ status: 'revoked', decidedAt: new Date(), decidedBySessionId: actorSessionId, updatedAt: new Date() }).where(eq(agentComputerPairings.id, pairingId))
  await recordComputerAudit(userId, 'computer.pairing.revoked', computer.id, { pairingId, deviceSessionId: pairing.deviceSessionId })
  await publishComputerEvent(computer.id, 'computer.pairing.decided', { pairingId, status: 'revoked' })
  await bumpComputersRevision(userId)
}

/** Pairings visible to a session: every pairing of computers it owns, plus its own requests. */
export async function listPairings(userId: string, sessionId: string | null, computerId?: string): Promise<ComputerPairing[]> {
  const rows = await db.select({ pairing: agentComputerPairings, computer: agentComputers, session: sessions })
    .from(agentComputerPairings)
    .innerJoin(agentComputers, eq(agentComputers.id, agentComputerPairings.computerId))
    .innerJoin(sessions, eq(sessions.id, agentComputerPairings.deviceSessionId))
    .where(and(
      eq(agentComputers.userId, userId),
      isNull(agentComputers.revokedAt),
      inArray(agentComputerPairings.status, ['pending', 'approved']),
      computerId ? eq(agentComputerPairings.computerId, computerId) : undefined,
      sessionId ? or(eq(agentComputers.ownerSessionId, sessionId), eq(agentComputerPairings.deviceSessionId, sessionId)) : undefined,
    ))
    .orderBy(desc(agentComputerPairings.requestedAt))
  return rows.map((row) => serializePairing(row.pairing, row.computer, row.session, sessionId))
}
