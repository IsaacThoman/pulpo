import type { Server as HttpServer } from 'node:http'
import { and, eq, inArray } from 'drizzle-orm'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-streams-adapter'
import type { ClientToServerEvents, ResponseSnapshot, ServerToClientEvents, SyncResult } from '@pulpo/contracts'
import { idSchema, syncRequestSchema } from '@pulpo/contracts'
import { createRedis } from '../redis.js'
import { getAllowedOrigins, getConfig } from '../config.js'
import { authenticateSessionToken, type AuthenticatedUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { chats, responses, users } from '../database/schema.js'
import { readResponseEvents } from '../responses/events.js'
import { toSnapshot } from '../responses/service.js'

interface SocketData {
  user: AuthenticatedUser
}

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

export async function createSocketServer(httpServer: HttpServer) {
  const config = getConfig()
  const allowedOrigins = getAllowedOrigins(config)
  const adapterRedis = createRedis()
  const subscriber = createRedis()
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    path: '/socket.io',
    cors: { origin: [...allowedOrigins], credentials: true },
    connectionStateRecovery: {
      maxDisconnectionDuration: 120_000,
      skipMiddlewares: false,
    },
    adapter: createAdapter(adapterRedis),
  })

  io.use(async (socket, next) => {
    try {
      const token = socketSessionToken(
        socket.handshake.auth,
        socket.handshake.headers.cookie,
        config.SESSION_COOKIE_NAME,
      )
      const user = await authenticateSessionToken(token)
      if (!user || user.role === 'pending') return next(new Error('unauthorized'))
      socket.data.user = user
      next()
    } catch (error) {
      next(error instanceof Error ? error : new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user
    void socket.join(`user:${user.id}`)

    socket.on('client.sync', (raw, ack) => {
      runSocketTask('client.sync', async () => {
        const input = syncRequestSchema.parse(raw)
        const [current] = await db.select({ revision: users.stateRevision }).from(users).where(eq(users.id, user.id)).limit(1)
        const responseIds = Object.keys(input.responseCursors)
        const owned = responseIds.length
          ? await db.select().from(responses).where(and(eq(responses.userId, user.id), inArray(responses.id, responseIds)))
          : []
        const result: SyncResult = {
          accountRevision: current?.revision ?? user.stateRevision,
          invalidate: current?.revision !== input.accountRevision ? ['chats', 'models', 'usage', 'settings'] : [],
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
        const [owned] = await db.select({ id: chats.id }).from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).limit(1)
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
        const [owned] = await db.select().from(responses).where(and(eq(responses.id, responseId), eq(responses.userId, user.id))).limit(1)
        if (!owned) return
        const events = await readResponseEvents(responseId, afterSequence)
        let replayedThrough = afterSequence
        if (events.length > 0 && events.length <= 2_000) {
          for (const event of events) socket.emit('response.event', event)
          replayedThrough = events.at(-1)?.sequence ?? afterSequence
        } else if (afterSequence < owned.lastSequence) {
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
      if (user.role === 'admin') void socket.join('admin:usage')
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

  await subscriber.subscribe('pulpo:response-events', 'pulpo:response-snapshots', 'pulpo:state-changes', 'pulpo:admin-usage')
  subscriber.on('message', (channel: string, message: string) => {
    if (channel === 'pulpo:admin-usage') {
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
    } else {
      const change = JSON.parse(message) as { userId: string; revision: number; chatId?: string }
      io.to(`user:${change.userId}`).emit('account.revision', { revision: change.revision })
      if (change.chatId) io.to(`user:${change.userId}`).emit('chat.changed', { chatId: change.chatId, revision: change.revision })
    }
  })

  return io
}
