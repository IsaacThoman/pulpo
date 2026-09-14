import { eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import type { Namespace, Server, Socket } from 'socket.io'
import {
  computerAnnounceSchema, computerPairingDecisionSchema, toolApprovalDecisionSchema,
  type ComputerClientToServerEvents, type ComputerReply, type ComputerServerToClientEvents,
} from '@pulpo/contracts'
import { authenticateSessionTokenWithSession, type AuthenticatedUser } from '../auth/service.js'
import { resolveClientIp } from '../lib/client-ip.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { agentComputers, applicationSettings } from '../database/schema.js'
import { parseAgentSettings } from '../settings/application-settings.js'
import { decideToolApproval } from '../agent/computer/approvals.js'
import { decidePairing } from '../agent/computer/pairings.js'
import { clearComputerPresence, markComputerOnline, refreshComputerPresence } from '../agent/computer/presence.js'
import { bumpComputersRevision, registerComputer, type ComputerRow } from '../agent/computer/registry.js'
import {
  COMPUTER_EVENTS_CHANNEL, COMPUTER_REPLIES_CHANNEL, COMPUTER_REQUESTS_CHANNEL,
  type ComputerEventEnvelope, type ComputerReplyEnvelope, type ComputerRequestEnvelope,
} from '../agent/computer/rpc.js'
import { redis } from '../redis.js'

export interface ComputerSocketData {
  user: AuthenticatedUser
  sessionId: string
  computer: ComputerRow
}

export type ComputerNamespace = Namespace<ComputerClientToServerEvents, ComputerServerToClientEvents, Record<string, never>, ComputerSocketData>
type ComputerSocket = Socket<ComputerClientToServerEvents, ComputerServerToClientEvents, Record<string, never>, ComputerSocketData>

export const COMPUTER_NAMESPACE = '/computer'

async function computersEnabled(): Promise<boolean> {
  const [row] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
  return parseAgentSettings(row?.value).computersEnabled
}

/**
 * Desktop apps connect here (one socket per enabled computer). The namespace tracks which
 * replica holds each socket, relays worker requests from Redis, and fans server events out.
 */
export function registerComputerNamespace(io: Server, subscriber: Redis): ComputerNamespace {
  const config = getConfig()
  const namespace = io.of(COMPUTER_NAMESPACE) as unknown as ComputerNamespace
  const local = new Map<string, ComputerSocket>()

  namespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.sessionToken
      const authenticated = typeof token === 'string' && token.length >= 32
        ? await authenticateSessionTokenWithSession(token, resolveClientIp(socket.request, config))
        : null
      if (!authenticated || authenticated.user.role === 'pending') return next(new Error('unauthorized'))
      if (!await computersEnabled()) return next(new Error('computers_disabled'))
      const announce = computerAnnounceSchema.safeParse(socket.handshake.auth.computer)
      if (!announce.success) return next(new Error('invalid_announce'))
      const computer = await registerComputer(authenticated.user.id, authenticated.sessionId, announce.data)
      socket.data.user = authenticated.user
      socket.data.sessionId = authenticated.sessionId
      socket.data.computer = computer
      next()
    } catch (error) {
      next(error instanceof Error ? error : new Error('unauthorized'))
    }
  })

  namespace.on('connection', (socket) => {
    const computer = socket.data.computer
    const computerId = computer.id
    const previous = local.get(computerId)
    if (previous && previous !== socket) {
      previous.emit('computer.superseded')
      previous.disconnect(true)
    }
    local.set(computerId, socket)
    void socket.join(`computer:${computerId}`)
    void markComputerOnline(computerId, socket.id).then(() => bumpComputersRevision(socket.data.user.id)).catch((error) => console.error('[computer] presence failed', error))

    socket.on('computer.heartbeat', () => {
      void refreshComputerPresence(computerId, socket.id).then(async (kept) => {
        if (!kept) await markComputerOnline(computerId, socket.id)
      }).catch(() => undefined)
    })

    socket.on('computer.update', (input, ack) => {
      void (async () => {
        const merged = computerAnnounceSchema.safeParse({ ...announceFromRow(socket.data.computer), ...(input && typeof input === 'object' ? input : {}), computerId })
        if (!merged.success) { ack?.({ ok: false, error: 'invalid_announce' }); return }
        socket.data.computer = await registerComputer(socket.data.user.id, socket.data.sessionId, merged.data)
        await bumpComputersRevision(socket.data.user.id)
        ack?.({ ok: true })
      })().catch((error) => ack?.({ ok: false, error: error instanceof Error ? error.message : 'update_failed' }))
    })

    socket.on('computer.approval.decide', (input, ack) => {
      void (async () => {
        const decision = toolApprovalDecisionSchema.parse(input)
        await decideToolApproval({ approvalId: decision.approvalId, approved: decision.approved, userId: socket.data.user.id, sessionId: socket.data.sessionId, via: 'desktop', computerId })
        ack?.({ ok: true })
      })().catch((error) => ack?.({ ok: false, error: error instanceof Error ? error.message : 'decision_failed' }))
    })

    socket.on('computer.pairing.decide', (input, ack) => {
      void (async () => {
        const decision = computerPairingDecisionSchema.parse(input)
        await decidePairing({ pairingId: decision.pairingId, approved: decision.approved, userId: socket.data.user.id, actorSessionId: socket.data.sessionId, requireOwner: true })
        ack?.({ ok: true })
      })().catch((error) => ack?.({ ok: false, error: error instanceof Error ? error.message : 'decision_failed' }))
    })

    socket.on('disconnect', () => {
      if (local.get(computerId) !== socket) return
      local.delete(computerId)
      void (async () => {
        await clearComputerPresence(computerId, socket.id)
        await db.update(agentComputers).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(agentComputers.id, computerId))
        await bumpComputersRevision(socket.data.user.id)
      })().catch((error) => console.error('[computer] disconnect cleanup failed', error))
    })
  })

  const relayRequest = async (envelope: ComputerRequestEnvelope) => {
    const socket = local.get(envelope.computerId)
    if (!socket) return
    let reply: ComputerReply
    try {
      reply = await socket.timeout(envelope.timeoutMs).emitWithAck('computer.request', envelope.request)
    } catch {
      reply = { ok: false, error: 'The computer did not acknowledge the request', code: 'failed' }
    }
    const response: ComputerReplyEnvelope = { requestId: envelope.requestId, reply }
    await redis.publish(COMPUTER_REPLIES_CHANNEL, JSON.stringify(response))
  }

  void subscriber.subscribe(COMPUTER_REQUESTS_CHANNEL, COMPUTER_EVENTS_CHANNEL, 'pulpo:session-revocations')
  subscriber.on('message', (channel: string, message: string) => {
    if (channel === COMPUTER_REQUESTS_CHANNEL) {
      let envelope: ComputerRequestEnvelope
      try { envelope = JSON.parse(message) as ComputerRequestEnvelope } catch { return }
      void relayRequest(envelope).catch((error) => console.error('[computer] relay failed', error))
    } else if (channel === COMPUTER_EVENTS_CHANNEL) {
      let envelope: ComputerEventEnvelope
      try { envelope = JSON.parse(message) as ComputerEventEnvelope } catch { return }
      const socket = local.get(envelope.computerId)
      ;(socket as unknown as { emit: (event: string, payload: unknown) => void } | undefined)?.emit(envelope.event, envelope.payload)
    } else if (channel === 'pulpo:session-revocations') {
      const event = JSON.parse(message) as { userId: string }
      for (const socket of local.values()) {
        // Reconnecting re-runs the middleware, which fails for a deleted session.
        if (socket.data.user.id === event.userId) socket.conn.close()
      }
    }
  })

  return namespace
}

function announceFromRow(row: ComputerRow) {
  return {
    computerId: row.id, name: row.name, os: row.os, arch: row.arch, appVersion: row.appVersion, accessMode: row.accessMode, rootPath: row.rootPath,
    attachmentsDir: row.attachmentsDir, homeDir: row.homeDir, shell: row.shell, approvalPolicy: row.approvalPolicy, allowRemote: row.allowRemote,
  }
}
