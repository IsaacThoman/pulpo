import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Server as HttpServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { Database } from '@hocuspocus/extension-database'
import { Redis as HocuspocusRedis } from '@hocuspocus/extension-redis'
import { Hocuspocus } from '@hocuspocus/server'
import { WebSocketServer, type RawData } from 'ws'
import { db } from '../database/client.js'
import { noteMemberships, notes } from '../database/schema.js'
import { authenticateSessionToken, type AuthenticatedUser } from '../auth/service.js'
import { createRedis } from '../redis.js'
import { getConfig, isAllowedOrigin } from '../config.js'
import { NOTE_DISCONNECT_CHANNEL, notifyNoteUsers } from './service.js'
import { readActiveNoteSourceLock } from './source-lock.js'

export const NOTE_COLLABORATION_PATH = '/notes-collaboration'

interface CollaborationContext {
  user: AuthenticatedUser
  noteId: string
  role: 'owner' | 'editor' | 'viewer'
  sessionId: string
}

interface ProviderToken {
  sessionToken?: string
  sessionId?: string
}

function providerToken(value: string): ProviderToken {
  try {
    const parsed = JSON.parse(value) as ProviderToken
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return value ? { sessionToken: value } : {}
  }
}

function cookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const pair of header.split(';')) {
    const [key, ...parts] = pair.trim().split('=')
    if (key === name) return decodeURIComponent(parts.join('='))
  }
  return undefined
}

function noteIdFromDocumentName(documentName: string): string | null {
  const match = /^note:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(documentName)
  return match?.[1] ?? null
}

function plainTextFromFragment(fragment: import('yjs').XmlFragment): string {
  return fragment.toString()
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|blockquote|pre|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim()
}

function plainTextFromBody(document: import('yjs').Doc): string {
  return plainTextFromFragment(document.getXmlFragment('body'))
}

function sessionColor(user: AuthenticatedUser, sessionId: string): string {
  const palette = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#059669', '#0891b2', '#4f46e5']
  let hash = 0
  for (const character of `${user.id}:${sessionId}`) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return palette[Math.abs(hash) % palette.length] ?? user.profileColor ?? '#2563eb'
}

function requestFromUpgrade(request: IncomingMessage): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item)
    else if (value !== undefined) headers.set(key, value)
  }
  const forwarded = request.headers['x-forwarded-proto']
  const protocol = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() === 'https' ? 'https' : 'http'
  return new Request(`${protocol}://${request.headers.host ?? 'localhost'}${request.url ?? NOTE_COLLABORATION_PATH}`, { headers })
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

export interface NoteCollaborationServer {
  flushPendingStores(): void
  destroy(): Promise<void>
}

export function createNoteCollaborationServer(httpServer: HttpServer): NoteCollaborationServer {
  const config = getConfig()
  const hocuspocus = new Hocuspocus<CollaborationContext>({
    name: `pulpo-${process.pid}`,
    debounce: 500,
    maxDebounce: 2_000,
    extensions: [
      new HocuspocusRedis({
        createClient: () => createRedis() as never,
        prefix: 'pulpo:hocuspocus',
      }),
      new Database({
        fetch: async ({ documentName }) => {
          const noteId = noteIdFromDocumentName(documentName)
          if (!noteId) return null
          const [row] = await db.select({ state: notes.documentState }).from(notes)
            .where(and(eq(notes.id, noteId), isNull(notes.purgeStartedAt))).limit(1)
          return row ? new Uint8Array(row.state) : null
        },
        store: async ({ documentName, document, state }) => {
          const noteId = noteIdFromDocumentName(documentName)
          if (!noteId) return
          const title = plainTextFromFragment(document.getXmlFragment('title')).replace(/\s+/g, ' ').trim().slice(0, 240) || 'Untitled note'
          const bodyText = plainTextFromBody(document)
          const [updated] = await db.update(notes).set({
            documentState: Buffer.from(state),
            title,
            bodyText,
            updatedAt: new Date(),
          }).where(and(eq(notes.id, noteId), isNull(notes.purgeStartedAt))).returning({ id: notes.id })
          if (!updated) return
          const members = await db.select({ userId: noteMemberships.userId }).from(noteMemberships)
            .where(eq(noteMemberships.noteId, noteId))
          await notifyNoteUsers(members.map((member) => member.userId))
        },
      }),
    ],
    onAuthenticate: async ({ documentName, token, requestHeaders, connectionConfig }) => {
      const noteId = noteIdFromDocumentName(documentName)
      if (!noteId) throw { code: 4404, reason: 'note-not-found' }
      const parsed = providerToken(token)
      const sessionToken = parsed.sessionToken
        ?? cookie(requestHeaders.get('cookie'), config.SESSION_COOKIE_NAME)
      const user = await authenticateSessionToken(sessionToken)
      if (!user || user.role === 'pending') throw { code: 4401, reason: 'unauthorized' }
      const [membership] = await db.select({ role: noteMemberships.role }).from(noteMemberships)
        .innerJoin(notes, eq(notes.id, noteMemberships.noteId))
        .where(and(
          eq(noteMemberships.noteId, noteId),
          eq(noteMemberships.userId, user.id),
          isNull(notes.deletedAt),
          isNull(notes.purgeStartedAt),
        )).limit(1)
      if (!membership) throw { code: 4404, reason: 'note-not-found' }
      const sessionId = parsed.sessionId?.slice(0, 128) || randomUUID()
      const lock = await readActiveNoteSourceLock(noteId)
      connectionConfig.readOnly = membership.role === 'viewer'
        || Boolean(lock && (lock.userId !== user.id || lock.sessionId !== sessionId))
      return { user, noteId, role: membership.role, sessionId }
    },
    beforeHandleMessage: async ({ context, connection }) => {
      const [membership] = await db.select({ role: noteMemberships.role }).from(noteMemberships)
        .innerJoin(notes, eq(notes.id, noteMemberships.noteId))
        .where(and(
          eq(noteMemberships.noteId, context.noteId),
          eq(noteMemberships.userId, context.user.id),
          isNull(notes.deletedAt),
          isNull(notes.purgeStartedAt),
        )).limit(1)
      if (!membership) throw { code: 4404, reason: 'note-not-found' }
      const lock = await readActiveNoteSourceLock(context.noteId)
      connection.readOnly = membership.role === 'viewer'
        || Boolean(lock && (lock.userId !== context.user.id || lock.sessionId !== context.sessionId))
    },
    beforeHandleAwareness: async ({ context, states }) => {
      if (!context) return
      for (const state of states.values()) {
        state.user = {
          id: context.user.id,
          name: context.user.name,
          username: context.user.username,
          avatarUrl: context.user.avatarUrl,
          color: sessionColor(context.user, context.sessionId),
          sessionId: context.sessionId,
        }
      }
    },
  })

  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024 })
  const accessSubscriber = createRedis()
  void accessSubscriber.subscribe(NOTE_DISCONNECT_CHANNEL)
  accessSubscriber.on('message', (channel, payload) => {
    if (channel !== NOTE_DISCONNECT_CHANNEL) return
    try {
      const noteIds = JSON.parse(payload) as string[]
      for (const noteId of noteIds) hocuspocus.closeConnections(`note:${noteId}`)
    } catch { /* Ignore malformed internal pub/sub messages. */ }
  })
  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname !== NOTE_COLLABORATION_PATH) return
    const origin = request.headers.origin
    if (origin && !isAllowedOrigin(origin, config)) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      const connection = hocuspocus.handleConnection(webSocket, requestFromUpgrade(request))
      webSocket.on('message', (data: RawData) => {
        const buffer = Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : Buffer.from(data)
        connection.handleMessage(new Uint8Array(buffer))
      })
      webSocket.on('close', (code, reason) => connection.handleClose({ code, reason: reason.toString() }))
    })
  })
  return {
    flushPendingStores: () => hocuspocus.flushPendingStores(),
    destroy: async () => {
      hocuspocus.closeConnections()
      hocuspocus.flushPendingStores()
      await hocuspocus.hooks('onDestroy', { instance: hocuspocus })
      accessSubscriber.disconnect()
      await new Promise<void>((resolve) => webSocketServer.close(() => resolve()))
    },
  }
}
