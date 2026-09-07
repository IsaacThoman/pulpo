import { currentProfile, withProfile } from '../profiles/context.js'
import { resolveProfile } from '../profiles/service.js'
import { profileEq, profileInArray } from '../profiles/context.js'
import { resolveClientIp } from '../lib/client-ip.js'
import { accessComposer } from '../composer/service.js'
import { composerDraftIdSchema, composerWriteSchema, type ComposerAck, type ComposerSnapshot } from '@pulpo/contracts'
import type { Server as HttpServer } from 'node:http'
import { and, eq, isNull } from 'drizzle-orm'
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
  profileId: string
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
  'shelved-drafts',
  'profiles',
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
  const [preferences] = await db.select({ values: userPreferences.values }).from(userPreferences).where(profileEq(userPreferences.userId, userId)).limit(1)
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

  const broadcastComposer = async (userId: string, snapshot: ComposerSnapshot, profileId = currentProfile()?.profileId) => {
    if (!profileId) return
    return withProfile({ userId, profileId }, async () => {
    if (snapshot.state?.temporary) return
    if (await composerAccountEnabled(userId)) io.to(`composer:${userId}:${profileId}`).emit('composer.changed', snapshot)
    })
  }

  io.use(async (socket, next) => {
    try {
      const token = socketSessionToken(
        socket.handshake.auth,
        socket.handshake.headers.cookie,
        config.SESSION_COOKIE_NAME,
      )
      const user = await authenticateSessionToken(token, resolveClientIp(socket.request, config))
      if (!user || user.role === 'pending') return next(new Error('unauthorized'))
      const accessToken = socket.handshake.auth.adminChatAccessToken
      const access = typeof accessToken === 'string'
        ? await resolveAdminChatSocketAccess(accessToken, user)
        : null
      if (accessToken && !access) return next(new Error('admin_chat_access_invalid'))
      socket.data.user = access?.ownerUser ?? user
      let profileId = socket.handshake.auth.profileId
      if (access) {
        const [chat] = await db.select({ profileId: chats.profileId }).from(chats).where(eq(chats.id, access.chatId))
        profileId = chat?.profileId
      }
      socket.data.profileId = (await resolveProfile(socket.data.user.id, profileId)).profileId
      socket.data.actorUser = user
      socket.data.adminChatAccess = access
      next()
    } catch (error) {
      next(error instanceof Error ? error : new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user
    const profileId = socket.data.profileId
    // Every listener gets its own async context and revalidates deletion.
    // Recovery can restore rooms from a previous handshake; never retain those subscriptions.
    for (const room of socket.rooms) if (/^(?:profile|composer|chat|response):/.test(room)) void socket.leave(room)
    const originalOn = socket.on.bind(socket)
    socket.on = ((event: string, listener: (...args: unknown[]) => unknown) => originalOn(event as never, ((...args: unknown[]) => {
      return resolveProfile(user.id, profileId).then((scope) => withProfile(scope, () => listener(...args))).catch(() => socket.disconnect(true))
    }) as never)) as typeof socket.on
    void socket.join(`session-actor:${socket.data.actorUser.id}`)
    const adminChatAccess = socket.data.adminChatAccess
    socket.data.composerSyncEnabled = !adminChatAccess && socket.handshake.auth.composerSyncEnabled !== false
    if (socket.data.composerSyncEnabled) void socket.join(`composer:${user.id}:${profileId}`)
    else void socket.leave(`composer:${user.id}:${profileId}`)
    socket.on('composer.configure', (input) => {
      if (adminChatAccess || typeof input?.enabled !== 'boolean') return
      socket.data.composerSyncEnabled = input.enabled
      if (input.enabled) void socket.join(`composer:${user.id}:${profileId}`)
      else void socket.leave(`composer:${user.id}:${profileId}`)
    })
    if (!adminChatAccess) { void socket.join(`user:${user.id}`); void socket.join(`profile:${profileId}`) }

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
            .innerJoin(chats, profileEq(chats.id, responses.chatId))
            .where(and(
              profileEq(responses.userId, user.id),
              profileInArray(responses.id, responseIds),
              adminChatAccess ? profileEq(chats.id, adminChatAccess.chatId) : undefined,
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
          profileEq(chats.id, chatId),
          adminChatAccess ? profileEq(chats.id, adminChatAccess.chatId) : undefined,
          profileEq(chats.userId, user.id),
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
          .innerJoin(chats, profileEq(chats.id, responses.chatId))
          .where(and(
            profileEq(responses.id, responseId),
            profileEq(responses.userId, user.id),
            adminChatAccess ? profileEq(chats.id, adminChatAccess.chatId) : undefined,
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

  const responseOwners = new Map<string, Promise<{ userId: string; chatId: string; profileId: string } | undefined>>()
  const ownerFor = async (responseId: string) => {
    const cached = responseOwners.get(responseId)
    if (cached) return cached
    const pending = db.select({ userId: responses.userId, chatId: responses.chatId, profileId: responses.profileId })
      .from(responses).where(profileEq(responses.id, responseId)).limit(1)
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
      runSocketTask('composer.changed', () => broadcastComposer(change.userId, change.snapshot, change.profileId))
    } else if (channel === 'pulpo:admin-usage') {
      io.to('admin:usage').emit('admin.usage.upsert', JSON.parse(message))
    } else if (channel === 'pulpo:response-events') {
      const event = JSON.parse(message) as { responseId: string }
      void ownerFor(event.responseId).then((owner) => {
        let rooms = io.to(`response:${event.responseId}`)
        if (owner) rooms = rooms.to(`chat:${owner.chatId}`).to(`profile:${owner.profileId}`)
        rooms.emit('response.event', event as never)
      })
    } else if (channel === 'pulpo:response-snapshots') {
      const snapshot = JSON.parse(message) as ResponseSnapshot
      void ownerFor(snapshot.responseId).then((owner) => {
        let rooms = io.to(`response:${snapshot.responseId}`)
        if (owner) rooms = rooms.to(`chat:${owner.chatId}`).to(`profile:${owner.profileId}`)
        rooms.emit('response.snapshot', snapshot)
        if (owner && snapshot.status === 'completed') {
          io.to(`profile:${owner.profileId}`).emit('response.completed', {
            responseId: snapshot.responseId, chatId: owner.chatId, preview: snapshotPreview(snapshot),
          })
        }
      })
    } else if (channel === 'pulpo:session-revocations') {
      const event = JSON.parse(message) as { userId: string }
      const room = io.of('/').adapter.rooms.get(`session-actor:${event.userId}`)
      for (const socketId of room ?? []) {
        // Closing the transport is reconnectable. The preserved session succeeds;
        // sockets using one of the deleted sessions fail the authentication middleware.
        io.of('/').sockets.get(socketId)?.conn.close()
      }
    } else {
      const change = JSON.parse(message) as {
        userId: string
        revision: number
        profileId?: string
        chatId?: string
        scopes?: StateInvalidationScope[]
      }
      const room = change.profileId ? `profile:${change.profileId}` : `user:${change.userId}`
      io.to(room).emit('account.revision', {
        revision: change.revision,
        ...(change.scopes?.length ? { scopes: change.scopes } : {}),
      })
      if (change.scopes?.includes('profiles')) runSocketTask('profiles.changed', async () => {
        const sockets = await io.in(`user:${change.userId}`).fetchSockets()
        await Promise.all(sockets.map(async (socket) => {
          try { await resolveProfile(change.userId, socket.data.profileId) }
          catch { socket.disconnect(true) }
        }))
      })
      if (change.chatId && change.profileId) void withProfile({ userId: change.userId, profileId: change.profileId }, () => accessComposer(change.userId, change.chatId!)).then((result) => { if (result.ok) return broadcastComposer(change.userId, result.snapshot, change.profileId) }).catch(() => undefined)
      if (change.chatId) io.to(room).to(`chat:${change.chatId}`).emit('chat.changed', { chatId: change.chatId, revision: change.revision })
    }
  })

  httpServer.once('close', () => {
    adapterRedis.disconnect()
    subscriber.disconnect()
  })
  return io
}
