import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import * as Y from 'yjs'
import { z } from 'zod'
import {
  createNoteSchema,
  idSchema,
  noteSourceLockSchema,
  updateNoteMemberSchema,
  updateNotePinSchema,
} from '@pulpo/contracts'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { friendships, noteMemberships, notes } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { maintenanceQueue } from '../jobs.js'
import { getTrashRetention } from '../chats/trash.js'
import {
  accessibleNote,
  disconnectNoteSessions,
  listNotes,
  noteDetail,
  noteMemberIds,
  notifyNoteUsers,
} from './service.js'
import {
  acquireNoteSourceLock,
  readActiveNoteSourceLock,
  releaseNoteSourceLock,
  renewNoteSourceLock,
} from './source-lock.js'
import { fetchLinkPreview } from './link-preview.js'

function initialDocumentState(): Buffer {
  const document = new Y.Doc()
  const title = document.getXmlFragment('title')
  const paragraph = new Y.XmlElement('paragraph')
  const text = new Y.XmlText()
  text.insert(0, 'Untitled note')
  paragraph.insert(0, [text])
  title.insert(0, [paragraph])
  document.getXmlFragment('body')
  return Buffer.from(Y.encodeStateAsUpdate(document))
}

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const noteParamsSchema = z.object({ id: idSchema })
const noteMemberParamsSchema = z.object({ id: idSchema, userId: idSchema })

async function acceptedFriends(transaction: DatabaseTransaction, leftUserId: string, rightUserId: string): Promise<boolean> {
  const [friendship] = await transaction.select({ id: friendships.id }).from(friendships).where(and(
    eq(friendships.status, 'accepted'),
    or(
      and(eq(friendships.userAId, leftUserId), eq(friendships.userBId, rightUserId)),
      and(eq(friendships.userAId, rightUserId), eq(friendships.userBId, leftUserId)),
    ),
  )).limit(1)
  return Boolean(friendship)
}

export async function registerNoteRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/notes/link-preview', async (request) => {
    requireUser(request)
    const input = z.object({ url: z.url().max(2_048) }).parse(request.body)
    return fetchLinkPreview(input.url)
  })
  app.get('/api/notes', async (request) => {
    const user = requireUser(request)
    const query = request.query as { scope?: string; q?: string }
    return { data: await listNotes(user.id, { trash: query.scope === 'trash', query: query.q }) }
  })

  app.post('/api/notes', async (request, reply) => {
    const user = requireUser(request)
    const input = createNoteSchema.parse(request.body ?? {})
    const noteId = input.id ?? newId()
    const now = new Date()
    const result = await db.transaction(async (tx) => {
      const [created] = await tx.insert(notes).values({
        id: noteId,
        ownerUserId: user.id,
        documentState: initialDocumentState(),
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().returning()
      if (!created) return null
      await tx.insert(noteMemberships).values({
        noteId,
        userId: user.id,
        role: 'owner',
        createdAt: now,
        updatedAt: now,
      })
      return created
    })
    if (!result) {
      const [existing] = await db.select({ id: notes.id }).from(notes).where(and(
        eq(notes.id, noteId), eq(notes.ownerUserId, user.id), isNull(notes.deletedAt),
      )).limit(1)
      if (!existing) throw new AppError(409, 'note_id_conflict', 'Note identifier is already in use')
    }
    await notifyNoteUsers([user.id])
    const access = await accessibleNote(user.id, noteId)
    reply.code(result ? 201 : 200)
    return noteDetail(access)
  })

  app.get('/api/notes/:id', async (request) => {
    const user = requireUser(request)
    const { id } = noteParamsSchema.parse(request.params)
    const includeDeletedOwnerNote = (request.query as { trash?: string }).trash === '1'
    const access = await accessibleNote(user.id, id, { includeDeletedOwnerNote })
    const detail = await noteDetail(access)
    const lock = await readActiveNoteSourceLock(id)
    return {
      ...detail,
      sourceLock: lock ? {
        userId: lock.userId,
        sessionId: lock.sessionId,
        expiresAt: lock.expiresAt,
      } : null,
    }
  })

  app.patch('/api/notes/:id/pin', async (request) => {
    const user = requireUser(request)
    const { id } = noteParamsSchema.parse(request.params)
    const input = updateNotePinSchema.parse(request.body)
    await accessibleNote(user.id, id)
    const [updated] = await db.update(noteMemberships).set({ pinned: input.pinned, updatedAt: new Date() })
      .where(and(eq(noteMemberships.noteId, id), eq(noteMemberships.userId, user.id))).returning()
    if (!updated) throw notFound('Note')
    await notifyNoteUsers([user.id])
    return { pinned: updated.pinned }
  })

  app.delete('/api/notes/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = noteParamsSchema.parse(request.params)
    const access = await accessibleNote(user.id, id)
    const memberIds = await db.transaction((tx) => noteMemberIds(tx, id))
    if (access.role !== 'owner') {
      await db.delete(noteMemberships).where(and(
        eq(noteMemberships.noteId, id), eq(noteMemberships.userId, user.id),
      ))
      await notifyNoteUsers(memberIds)
      await disconnectNoteSessions([id])
      reply.code(204).send()
      return
    }
    const now = new Date()
    const retention = await getTrashRetention(user.id)
    await db.update(notes).set({
      deletedAt: now,
      purgeStartedAt: retention === 'instant' ? now : null,
      updatedAt: now,
    }).where(and(eq(notes.id, id), eq(notes.ownerUserId, user.id), isNull(notes.deletedAt)))
    await notifyNoteUsers(memberIds)
    await disconnectNoteSessions([id])
    if (retention === 'instant') {
      await maintenanceQueue.add('purge-notes', { type: 'purge-notes', payload: { userId: user.id } }, {
        jobId: `purge-notes-${user.id}-${Date.now()}`,
      })
    }
    reply.code(204).send()
  })

  app.post('/api/notes/:id/restore', async (request) => {
    const user = requireUser(request)
    const { id } = noteParamsSchema.parse(request.params)
    const access = await accessibleNote(user.id, id, { includeDeletedOwnerNote: true })
    if (access.role !== 'owner') throw notFound('Note')
    const [updated] = await db.update(notes).set({ deletedAt: null, purgeStartedAt: null, updatedAt: new Date() })
      .where(and(eq(notes.id, id), eq(notes.ownerUserId, user.id), isNull(notes.purgeStartedAt))).returning()
    if (!updated) throw notFound('Note')
    const memberIds = await db.transaction((tx) => noteMemberIds(tx, id))
    await notifyNoteUsers(memberIds)
    await disconnectNoteSessions([id])
    return noteDetail(await accessibleNote(user.id, id))
  })

  app.delete('/api/notes/:id/permanent', async (request, reply) => {
    const user = requireUser(request)
    const { id } = noteParamsSchema.parse(request.params)
    const access = await accessibleNote(user.id, id, { includeDeletedOwnerNote: true })
    if (access.role !== 'owner') throw notFound('Note')
    const memberIds = await db.transaction((tx) => noteMemberIds(tx, id))
    await db.update(notes).set({ purgeStartedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notes.id, id), eq(notes.ownerUserId, user.id)))
    await notifyNoteUsers(memberIds)
    await disconnectNoteSessions([id])
    await maintenanceQueue.add('purge-notes', { type: 'purge-notes', payload: { userId: user.id } }, {
      jobId: `purge-note-${id}-${Date.now()}`,
    })
    reply.code(202).send()
  })

  app.put('/api/notes/:id/members/:userId', async (request) => {
    const owner = requireUser(request)
    const { id, userId } = noteMemberParamsSchema.parse(request.params)
    const input = updateNoteMemberSchema.parse(request.body)
    const access = await accessibleNote(owner.id, id)
    if (access.role !== 'owner') throw notFound('Note')
    if (userId === owner.id) throw new AppError(409, 'note_owner_role_fixed', 'The note owner role cannot be changed')
    await db.transaction(async (tx) => {
      const pair = [owner.id, userId].sort().join(':')
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pair}))`)
      if (!await acceptedFriends(tx, owner.id, userId)) {
        throw new AppError(409, 'note_member_not_friend', 'Only accepted friends can be added to a note')
      }
      await tx.insert(noteMemberships).values({ noteId: id, userId, role: input.role })
        .onConflictDoUpdate({
          target: [noteMemberships.noteId, noteMemberships.userId],
          set: { role: input.role, updatedAt: new Date() },
        })
    })
    const memberIds = await db.transaction((tx) => noteMemberIds(tx, id))
    await notifyNoteUsers(memberIds)
    await disconnectNoteSessions([id])
    return noteDetail(await accessibleNote(owner.id, id))
  })

  app.delete('/api/notes/:id/members/:userId', async (request, reply) => {
    const owner = requireUser(request)
    const { id, userId } = noteMemberParamsSchema.parse(request.params)
    const access = await accessibleNote(owner.id, id)
    if (access.role !== 'owner') throw notFound('Note')
    if (userId === owner.id) throw new AppError(409, 'note_owner_cannot_leave', 'The note owner cannot be removed')
    const memberIds = await db.transaction((tx) => noteMemberIds(tx, id))
    await db.delete(noteMemberships).where(and(
      eq(noteMemberships.noteId, id), eq(noteMemberships.userId, userId),
    ))
    await notifyNoteUsers(memberIds)
    await disconnectNoteSessions([id])
    reply.code(204).send()
  })

  app.post('/api/notes/:id/source-lock', async (request, reply) => {
    const user = requireUser(request)
    const { id } = noteParamsSchema.parse(request.params)
    const input = noteSourceLockSchema.parse(request.body)
    const access = await accessibleNote(user.id, id)
    if (access.role === 'viewer') throw new AppError(403, 'note_read_only', 'This note is read-only')
    await readActiveNoteSourceLock(id)
    const lock = await acquireNoteSourceLock(id, user.id, input.sessionId)
    if (!lock) throw new AppError(409, 'note_source_locked', 'Another session is editing Markdown source')
    const memberIds = await db.transaction((tx) => noteMemberIds(tx, id))
    await notifyNoteUsers(memberIds)
    reply.code(201)
    return { token: lock.token, expiresAt: lock.expiresAt }
  })

  app.put('/api/notes/:id/source-lock', async (request) => {
    const user = requireUser(request)
    const { id } = noteParamsSchema.parse(request.params)
    const input = noteSourceLockSchema.parse(request.body)
    await accessibleNote(user.id, id)
    if (!input.token) throw new AppError(400, 'note_source_lock_token_required', 'Source lock token is required')
    const current = await readActiveNoteSourceLock(id)
    if (!current || current.token !== input.token || current.userId !== user.id || current.sessionId !== input.sessionId) {
      throw new AppError(409, 'note_source_lock_lost', 'The Markdown source lock has expired')
    }
    const lock = await renewNoteSourceLock(id, input.token)
    if (!lock || lock.userId !== user.id || lock.sessionId !== input.sessionId) {
      throw new AppError(409, 'note_source_lock_lost', 'The Markdown source lock has expired')
    }
    return { token: lock.token, expiresAt: lock.expiresAt }
  })

  app.delete('/api/notes/:id/source-lock', async (request, reply) => {
    const user = requireUser(request)
    const { id } = noteParamsSchema.parse(request.params)
    const input = noteSourceLockSchema.parse(request.body)
    await accessibleNote(user.id, id)
    const current = await readActiveNoteSourceLock(id)
    if (!input.token || !current || current.token !== input.token || current.userId !== user.id || current.sessionId !== input.sessionId
      || !await releaseNoteSourceLock(id, input.token)) {
      throw new AppError(409, 'note_source_lock_lost', 'The Markdown source lock has expired')
    }
    const memberIds = await db.transaction((tx) => noteMemberIds(tx, id))
    await notifyNoteUsers(memberIds)
    reply.code(204).send()
  })
}
