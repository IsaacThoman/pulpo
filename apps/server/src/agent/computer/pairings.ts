import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import type { ComputerPairing, ComputerPairingStatus } from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { agentComputerPairings, agentComputers, sessions } from '../../database/schema.js'
import { serializeDeviceSession } from '../../auth/device-sessions.js'
import { AppError, notFound } from '../../lib/errors.js'
import { consumePairingCode } from './pairing-codes.js'
import { newId } from '../../lib/ids.js'
import { computerIsOnline } from './presence.js'
import { publishComputerEvent } from './rpc.js'
import { bumpComputersRevision, recordComputerAudit, revokeComputerSession, type ComputerRow } from './registry.js'

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

/** A signed-in device redeems a one-use code displayed only on the owning desktop. */
export async function requestPairing(userId: string, sessionId: string, computerId: string, requestedIp: string | null, code: string): Promise<ComputerPairing> {
  const pairing = await db.transaction(async (tx) => {
    const [computer] = await tx.select().from(agentComputers).where(and(eq(agentComputers.id, computerId), eq(agentComputers.userId, userId), isNull(agentComputers.revokedAt))).limit(1).for('update')
    if (!computer) throw notFound('Computer')
    if (!computer.enabled || !computer.allowRemote) throw new AppError(403, 'computer_remote_disabled', 'Turn on remote access on the computer first')
    if (computer.ownerSessionId === sessionId) throw new AppError(409, 'computer_owner_session', 'This device already owns the computer')
    if (!await computerIsOnline(computerId)) throw new AppError(409, 'computer_offline', 'Open Pulpo on the computer first')
    const [session] = await tx.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId))).limit(1)
    if (!session || session.expiresAt.getTime() <= Date.now()) throw notFound('Session')
    await consumePairingCode(computerId, userId, code)
    await tx.update(agentComputerPairings).set({ status: 'revoked', updatedAt: new Date() }).where(and(eq(agentComputerPairings.computerId, computerId), eq(agentComputerPairings.deviceSessionId, sessionId), inArray(agentComputerPairings.status, ['pending', 'approved'])))
    const [row] = await tx.insert(agentComputerPairings).values({ id: newId(), computerId, deviceSessionId: sessionId, status: 'approved', requestedIp, decidedAt: new Date(), decidedBySessionId: sessionId }).returning()
    if (!row) throw new Error('Unable to pair device')
    return serializePairing(row, computer, session, sessionId)
  })
  await recordComputerAudit(userId, 'computer.pairing.approved', computerId, { pairingId: pairing.id, deviceSessionId: sessionId, via: 'code' })
  await publishComputerEvent(computerId, 'computer.access.granted', { sessionId })
  await bumpComputersRevision(userId)
  return pairing
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
  await revokeComputerSession(computer.id, pairing.deviceSessionId)
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
