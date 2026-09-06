import { accessComposer } from '../composer/service.js'
import { composerDraftIdSchema, composerWriteSchema, type ComposerAck, type ComposerSnapshot } from '@pulpo/contracts'
import type { Server as HttpServer } from 'node:http'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-streams-adapter'
import type {
  ClientToServerEvents,
  ResponseSnapshot,
  ServerToClientEvents,
  StateInvalidationScope,
  SyncResult,
} from '@pulpo/contracts'
import { idSchema, syncRequestSchema } from '@pulpo/contracts'
import { createRedis } from '../redis.js'
import { getConfig, isAllowedOrigin } from '../config.js'
import { authenticateSessionToken, type AdminChatAccessContext, type AuthenticatedUser } from '../auth/service.js'
import { resolveAdminChatSocketAccess } from '../admin/chat-access.js'
import { db } from '../database/client.js'
import { chats, responses, users, userPreferences } from '../database/schema.js'
import { readResponseEvents } from '../responses/events.js'
import { toSnapshot } from '../responses/service.js'
import { accessibleChatCondition } from '../chats/temporary.js'

interface SocketData {
  composerSyncEnabled: boolean
  user: AuthenticatedUser
  actorUser: AuthenticatedUser
  adminChatAccess: AdminChatAccessContext | null
}

export const FULL_STATE_INVALIDATION_SCOPES: StateInvalidationScope[] = [
  'chats',
  'folders',
  'models',
  'usage',
  'settings',
  'friends',
  'pool',
  'billing',
]

export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const pair of header.split(';')) {
    const [key, ...value] = pair.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return undefined
}

export function socketSessionToken(
  auth: Record<string, unknown>,
  cookieHeader: string | undefined,
  cookieName: string,
): string | undefined {
  const authToken = auth.sessionToken
  return typeof authToken === 'string' && authToken.length >= 32
    ? authToken
    : cookieValue(cookieHeader, cookieName)
}

export function realtimeResourceId(value: unknown): string | undefined {
  const result = idSchema.safeParse(value)
  return result.success ? result.data : undefined
}

function runSocketTask(event: string, task: () => Promise<void>): void {
  void task().catch((error) => {
    console.error(`[realtime] ${event} failed`, error)
  })
}

function snapshotPreview(snapshot: ResponseSnapshot): string {
  for (const item of snapshot.output) {
    const content = (item as { type?: string; content?: Array<{ type?: string; text?: string }> }).content
    const text = content?.find((part) => part.type === 'output_text')?.text
    if (text) return text.slice(0, 160)
  }
  return 'Open the chat to view the response.'
}

async function composerAccountEnabled(userId: string): Promise<boolean> {
  const [preferences] = await db.select({ values: userPreferences.values }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1)
  return (preferences?.values as { composerSyncEnabled?: unknown } | undefined)?.composerSyncEnabled !== false
}

export async function createSocketServer(httpServer: HttpServer) {
  const config = getConfig()
  const adapterRedis = createRedis()
  const subscriber = createRedis()
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    path: '/socket.io',
    maxHttpBufferSize: 4_100_000,
    cors: {
      origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin, config)),
      credentials: true,
    },
    connectionStateRecovery: {
      maxDisconnectionDuration: 120_000,
      skipMiddlewares: false,
    },
    adapter: createAdapter(adapterRedis),
  })

  const broadcastComposer = async (userId: string, snapshot: ComposerSnapshot) => {
    if (await composerAccountEnabled(userId)) io.to(`composer:${userId}`).emit('composer.changed', snapshot)
  }

  io.use(async (socket, next) => {
    try {
      const token = socketSessionToken(
        socket.handshake.auth,
        socket.handshake.headers.cookie,
        config.SESSION_COOKIE_NAME,
      )
      const user = await authenticateSessionToken(token)
      if (!user || user.role === 'pending') return next(new Error('unauthorized'))
      const accessToken = socket.handshake.auth.adminChatAccessToken
      const access = typeof accessToken === 'string'
        ? await resolveAdminChatSocketAccess(accessToken, user)
        : null
      if (accessToken && !access) return next(new Error('admin_chat_access_invalid'))
      socket.data.user = access?.ownerUser ?? user
      socket.data.actorUser = user
      socket.data.adminChatAccess = access
      next()
    } catch (error) {
      next(error instanceof Error ? error : new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user
    const adminChatAccess = socket.data.adminChatAccess
    socket.data.composerSyncEnabled = !adminChatAccess && socket.handshake.auth.composerSyncEnabled !== false
    if (socket.data.composerSyncEnabled) void socket.join(`composer:${user.id}`)
    else void socket.leave(`composer:${user.id}`)
    socket.on('composer.configure', (input) => {
      if (adminChatAccess || typeof input?.enabled !== 'boolean') return
      socket.data.composerSyncEnabled = input.enabled
      if (input.enabled) void socket.join(`composer:${user.id}`)
      else void socket.leave(`composer:${user.id}`)
    })
    if (!adminChatAccess) void socket.join(`user:${user.id}`)

    const composerTask = async (raw: unknown, ack: (result: ComposerAck) => void, writing: boolean) => {
      if (typeof ack !== 'function') return
      if (adminChatAccess || !socket.data.composerSyncEnabled) { ack({ ok: false, error: 'unauthorized' }); return }
      try {
        if (!await composerAccountEnabled(user.id)) { ack({ ok: false, error: 'composer_sync_disabled' }); return }
        const write = writing ? composerWriteSchema.parse(raw) : undefined
        const draftId = write?.draftId ?? composerDraftIdSchema.parse((raw as { draftId?: unknown })?.draftId)
        const result = await accessComposer(user.id, draftId, write)
        ack(result)
        if (result.ok) runSocketTask('composer.changed', () => broadcastComposer(user.id, result.snapshot))
      } catch {
        ack({ ok: false, error: 'composer_sync_failed' })
      }
    }
    socket.on('composer.read', (raw, ack) => { void composerTask(raw, ack, false) })
    socket.on('composer.write', (raw, ack) => { void composerTask(raw, ack, true) })

    socket.on('client.sync', (raw, ack) => {
      runSocketTask('client.sync', async () => {
        const input = syncRequestSchema.parse(raw)
        const [current] = await db.select({ revision: users.stateRevision }).from(users).where(eq(users.id, user.id)).limit(1)
        const responseIds = Object.keys(input.responseCursors)
        const owned = responseIds.length
          ? await db.select({ response: responses }).from(responses)
            .innerJoin(chats, eq(chats.id, responses.chatId))
            .where(and(
              eq(responses.userId, user.id),
              inArray(responses.id, responseIds),
              adminChatAccess ? eq(chats.id, adminChatAccess.chatId) : undefined,
              isNull(chats.deletedAt),
              accessibleChatCondition(),
            )).then((rows) => rows.map((row) => row.response))
          : []
        const result: SyncResult = {
          accountRevision: current?.revision ?? user.stateRevision,
          invalidate: !adminChatAccess && current?.revision !== input.accountRevision
            ? FULL_STATE_INVALIDATION_SCOPES
            : [],
          snapshots: [],
          events: [],
        }
        for (const response of owned) {
          const cursor = input.responseCursors[response.id] ?? 0
          const events = await readResponseEvents(response.id, cursor)
          if (events.length > 0 && events.length <= 2_000) result.events.push(...events)
          else if (cursor < response.lastSequence || response.status !== 'in_progress') result.snapshots.push(toSnapshot(response))
        }
        ack(result)
      })
    })

    socket.on('chat.subscribe', ({ chatId: rawChatId }) => {
      const chatId = realtimeResourceId(rawChatId)
      if (!chatId) return
      runSocketTask('chat.subscribe', async () => {
        const [owned] = await db.select({ id: chats.id }).from(chats).where(and(
          eq(chats.id, chatId),
          adminChatAccess ? eq(chats.id, adminChatAccess.chatId) : undefined,
          eq(chats.userId, user.id),
          isNull(chats.deletedAt),
          accessibleChatCondition(),
        )).limit(1)
        if (owned) await socket.join(`chat:${chatId}`)
      })
    })
    socket.on('chat.unsubscribe', ({ chatId: rawChatId }) => {
      const chatId = realtimeResourceId(rawChatId)
      if (chatId) void socket.leave(`chat:${chatId}`)
    })
    socket.on('response.subscribe', ({ responseId: rawResponseId, afterSequence }) => {
      const responseId = realtimeResourceId(rawResponseId)
      if (!responseId || !Number.isSafeInteger(afterSequence) || afterSequence < 0) return
      runSocketTask('response.subscribe', async () => {
        const [row] = await db.select({ response: responses }).from(responses)
          .innerJoin(chats, eq(chats.id, responses.chatId))
          .where(and(
            eq(responses.id, responseId),
            eq(responses.userId, user.id),
            adminChatAccess ? eq(chats.id, adminChatAccess.chatId) : undefined,
            isNull(chats.deletedAt),
            accessibleChatCondition(),
          )).limit(1)
        const owned = row?.response
        if (!owned) return
        const events = await readResponseEvents(responseId, afterSequence)
        let replayedThrough = afterSequence
        let snapshotSent = false
        if (events.length > 0 && events.length <= 2_000) {
          for (const event of events) socket.emit('response.event', event)
          replayedThrough = events.at(-1)?.sequence ?? afterSequence
        } else if (afterSequence < owned.lastSequence) {
          socket.emit('response.snapshot', toSnapshot(owned))
          replayedThrough = owned.lastSequence
          snapshotSent = true
        }
        if (!snapshotSent && !['queued', 'in_progress'].includes(owned.status)) {
          socket.emit('response.snapshot', toSnapshot(owned))
          replayedThrough = owned.lastSequence
        }
        await socket.join(`response:${responseId}`)
        const racedEvents = await readResponseEvents(responseId, replayedThrough)
        for (const event of racedEvents) socket.emit('response.event', event)
      })
    })
    socket.on('response.unsubscribe', ({ responseId: rawResponseId }) => {
      const responseId = realtimeResourceId(rawResponseId)
      if (responseId) void socket.leave(`response:${responseId}`)
    })
    socket.on('admin.usage.subscribe', () => {
      if (!adminChatAccess && user.role === 'admin') void socket.join('admin:usage')
    })
    socket.on('admin.usage.unsubscribe', () => void socket.leave('admin:usage'))
  })

  const responseOwners = new Map<string, Promise<{ userId: string; chatId: string } | undefined>>()
  const ownerFor = async (responseId: string) => {
    const cached = responseOwners.get(responseId)
    if (cached) return cached
    const pending = db.select({ userId: responses.userId, chatId: responses.chatId })
      .from(responses).where(eq(responses.id, responseId)).limit(1)
      .then((rows) => rows[0])
      .catch((error) => {
        responseOwners.delete(responseId)
        throw error
      })
    responseOwners.set(responseId, pending)
    return pending
  }

  await subscriber.subscribe('pulpo:composer-changes', 'pulpo:response-events', 'pulpo:response-snapshots', 'pulpo:state-changes', 'pulpo:session-revocations', 'pulpo:admin-usage')
  subscriber.on('message', (channel: string, message: string) => {
    if (channel === 'pulpo:composer-changes') {
      const change = JSON.parse(message)
      runSocketTask('composer.changed', () => broadcastComposer(change.userId, change.snapshot))
    } else if (channel === 'pulpo:admin-usage') {
      io.to('admin:usage').emit('admin.usage.upsert', JSON.parse(message))
    } else if (channel === 'pulpo:response-events') {
      const event = JSON.parse(message) as { responseId: string }
      void ownerFor(event.responseId).then((owner) => {
        let rooms = io.to(`response:${event.responseId}`)
        if (owner) rooms = rooms.to(`chat:${owner.chatId}`).to(`user:${owner.userId}`)
        rooms.emit('response.event', event as never)
      })
    } else if (channel === 'pulpo:response-snapshots') {
      const snapshot = JSON.parse(message) as ResponseSnapshot
      void ownerFor(snapshot.responseId).then((owner) => {
        let rooms = io.to(`response:${snapshot.responseId}`)
        if (owner) rooms = rooms.to(`chat:${owner.chatId}`).to(`user:${owner.userId}`)
        rooms.emit('response.snapshot', snapshot)
        if (owner && snapshot.status === 'completed') {
          io.to(`user:${owner.userId}`).emit('response.completed', {
            responseId: snapshot.responseId, chatId: owner.chatId, preview: snapshotPreview(snapshot),
          })
        }
      })
    } else if (channel === 'pulpo:session-revocations') {
      const event = JSON.parse(message) as { userId: string }
      const room = io.of('/').adapter.rooms.get(`user:${event.userId}`)
      for (const socketId of room ?? []) {
        // Closing the transport is reconnectable. The preserved session succeeds;
        // sockets using one of the deleted sessions fail the authentication middleware.
        io.of('/').sockets.get(socketId)?.conn.close()
      }
    } else {
      const change = JSON.parse(message) as {
        userId: string
        revision: number
        chatId?: string
        scopes?: StateInvalidationScope[]
      }
      io.to(`user:${change.userId}`).emit('account.revision', {
        revision: change.revision,
        ...(change.scopes?.length ? { scopes: change.scopes } : {}),
      })
      if (change.chatId) void accessComposer(change.userId, change.chatId).then((result) => { if (result.ok) return broadcastComposer(change.userId, result.snapshot) }).catch(() => undefined)
      if (change.chatId) io.to(`user:${change.userId}`).to(`chat:${change.chatId}`).emit('chat.changed', { chatId: change.chatId, revision: change.revision })
    }
  })

  httpServer.once('close', () => {
    adapterRedis.disconnect()
    subscriber.disconnect()
  })
  return io
}
