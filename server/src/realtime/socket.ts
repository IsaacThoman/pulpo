import type { Server as HttpServer } from 'node:http'
import { and, eq, inArray } from 'drizzle-orm'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-streams-adapter'
import type { ClientToServerEvents, ServerToClientEvents, SyncResult } from '@pulpo/contracts'
import { syncRequestSchema } from '@pulpo/contracts'
import { createRedis } from '../redis.js'
import { getConfig } from '../config.js'
import { authenticateSessionToken, type AuthenticatedUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { chats, responses, users } from '../database/schema.js'
import { readResponseEvents } from '../responses/events.js'
import { toSnapshot } from '../responses/service.js'

interface SocketData {
  user: AuthenticatedUser
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const pair of header.split(';')) {
    const [key, ...value] = pair.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return undefined
}

export async function createSocketServer(httpServer: HttpServer) {
  const config = getConfig()
  const adapterRedis = createRedis()
  const subscriber = createRedis()
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    path: '/socket.io',
    cors: { origin: config.PUBLIC_URL, credentials: true },
    connectionStateRecovery: {
      maxDisconnectionDuration: 120_000,
      skipMiddlewares: false,
    },
    adapter: createAdapter(adapterRedis),
  })

  io.use(async (socket, next) => {
    try {
      const token = cookieValue(socket.handshake.headers.cookie, config.SESSION_COOKIE_NAME)
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

    socket.on('client.sync', async (raw, ack) => {
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

    socket.on('chat.subscribe', async ({ chatId }) => {
      const [owned] = await db.select({ id: chats.id }).from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).limit(1)
      if (owned) await socket.join(`chat:${chatId}`)
    })
    socket.on('chat.unsubscribe', ({ chatId }) => void socket.leave(`chat:${chatId}`))
    socket.on('response.subscribe', async ({ responseId, afterSequence }) => {
      const [owned] = await db.select().from(responses).where(and(eq(responses.id, responseId), eq(responses.userId, user.id))).limit(1)
      if (!owned) return
      await socket.join(`response:${responseId}`)
      const events = await readResponseEvents(responseId, afterSequence)
      if (events.length > 0 && events.length <= 2_000) {
        for (const event of events) socket.emit('response.event', event)
      } else if (afterSequence < owned.lastSequence) {
        socket.emit('response.snapshot', toSnapshot(owned))
      }
    })
    socket.on('response.unsubscribe', ({ responseId }) => void socket.leave(`response:${responseId}`))
  })

  await subscriber.subscribe('pulpo:response-events', 'pulpo:response-snapshots')
  subscriber.on('message', (channel: string, message: string) => {
    if (channel === 'pulpo:response-events') {
      const event = JSON.parse(message)
      io.to(`response:${event.responseId}`).emit('response.event', event)
    } else {
      const snapshot = JSON.parse(message)
      io.to(`response:${snapshot.responseId}`).emit('response.snapshot', snapshot)
    }
  })

  return io
}
