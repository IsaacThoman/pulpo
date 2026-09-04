import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { NoteDetail, NoteRole, NoteSummary } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { attachments, noteMemberships, notes, users } from '../database/schema.js'
import { notFound } from '../lib/errors.js'
import { getBlobStore } from '../storage/index.js'
import { publicFriendProfile } from '../profile/service.js'
import { bumpAccountRevisions, publishScopedStateChanges } from '../friends/sync.js'
import { getTrashRetention, purgeAtFor } from '../chats/trash.js'
import { createRedis } from '../redis.js'

export const NOTE_DISCONNECT_CHANNEL = 'pulpo:notes:disconnect'

export async function disconnectNoteSessions(noteIds: string[]): Promise<void> {
  const unique = [...new Set(noteIds)]
  if (!unique.length) return
  const publisher = createRedis()
  try { await publisher.publish(NOTE_DISCONNECT_CHANNEL, JSON.stringify(unique)) } finally { publisher.disconnect() }
}

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface NoteAccess {
  note: typeof notes.$inferSelect
  role: NoteRole
  pinned: boolean
  owner: typeof users.$inferSelect
}

export function noteExcerpt(bodyText: string): string {
  return bodyText.replace(/\s+/g, ' ').trim().slice(0, 180)
}

export async function accessibleNote(
  userId: string,
  noteId: string,
  options: { includeDeletedOwnerNote?: boolean } = {},
): Promise<NoteAccess> {
  const [row] = await db.select({
    note: notes,
    role: noteMemberships.role,
    pinned: noteMemberships.pinned,
    owner: users,
  }).from(noteMemberships)
    .innerJoin(notes, eq(notes.id, noteMemberships.noteId))
    .innerJoin(users, eq(users.id, notes.ownerUserId))
    .where(and(
      eq(noteMemberships.noteId, noteId),
      eq(noteMemberships.userId, userId),
      isNull(notes.purgeStartedAt),
      options.includeDeletedOwnerNote
        ? and(eq(notes.ownerUserId, userId), isNotNull(notes.deletedAt))
        : isNull(notes.deletedAt),
    )).limit(1)
  if (!row) throw notFound('Note')
  return row
}

export async function noteMemberIds(transaction: DatabaseTransaction, noteId: string): Promise<string[]> {
  const rows = await transaction.select({ userId: noteMemberships.userId })
    .from(noteMemberships).where(eq(noteMemberships.noteId, noteId))
  return rows.map((row) => row.userId)
}

export async function notifyNoteUsers(userIds: string[]): Promise<void> {
  if (!userIds.length) return
  const changes = await db.transaction((tx) => bumpAccountRevisions(tx, userIds))
  await publishScopedStateChanges(changes, ['notes'])
}

async function collaboratorCounts(noteIds: string[]): Promise<Map<string, number>> {
  if (!noteIds.length) return new Map()
  const rows = await db.select({
    noteId: noteMemberships.noteId,
    count: sql<number>`greatest(count(*)::int - 1, 0)`,
  }).from(noteMemberships).where(inArray(noteMemberships.noteId, noteIds)).groupBy(noteMemberships.noteId)
  return new Map(rows.map((row) => [row.noteId, Number(row.count)]))
}

function summaryFromRow(
  row: Pick<NoteAccess, 'note' | 'role' | 'pinned' | 'owner'>,
  collaboratorCount: number,
): NoteSummary {
  return {
    id: row.note.id,
    title: row.note.title || 'Untitled note',
    excerpt: noteExcerpt(row.note.bodyText),
    role: row.role,
    pinned: row.pinned,
    owner: publicFriendProfile(row.owner),
    collaboratorCount,
    createdAt: row.note.createdAt.toISOString(),
    updatedAt: row.note.updatedAt.toISOString(),
    deletedAt: row.note.deletedAt?.toISOString() ?? null,
  }
}

export async function listNotes(userId: string, input: {
  trash?: boolean
  query?: string
} = {}): Promise<NoteSummary[]> {
  const query = input.query?.trim().slice(0, 200)
  const rows = await db.select({
    note: notes,
    role: noteMemberships.role,
    pinned: noteMemberships.pinned,
    owner: users,
  }).from(noteMemberships)
    .innerJoin(notes, eq(notes.id, noteMemberships.noteId))
    .innerJoin(users, eq(users.id, notes.ownerUserId))
    .where(and(
      eq(noteMemberships.userId, userId),
      isNull(notes.purgeStartedAt),
      input.trash
        ? and(eq(notes.ownerUserId, userId), isNotNull(notes.deletedAt))
        : isNull(notes.deletedAt),
      query ? sql`${notes.searchVector} @@ websearch_to_tsquery('simple', ${query})` : undefined,
    ))
    .orderBy(desc(noteMemberships.pinned), desc(notes.updatedAt))
    .limit(query ? 100 : 500)
  const counts = await collaboratorCounts(rows.map((row) => row.note.id))
  return rows.map((row) => summaryFromRow(row, counts.get(row.note.id) ?? 0))
}

export async function noteDetail(access: NoteAccess): Promise<NoteDetail> {
  const members = await db.select({ membership: noteMemberships, profile: users })
    .from(noteMemberships)
    .innerJoin(users, eq(users.id, noteMemberships.userId))
    .where(eq(noteMemberships.noteId, access.note.id))
    .orderBy(noteMemberships.createdAt)
  return {
    ...summaryFromRow(access, Math.max(0, members.length - 1)),
    members: members.map(({ membership, profile }) => ({
      profile: publicFriendProfile(profile),
      role: membership.role,
      joinedAt: membership.createdAt.toISOString(),
    })),
  }
}

export async function revokeNoteMembershipsBetween(
  transaction: DatabaseTransaction,
  leftUserId: string,
  rightUserId: string,
): Promise<string[]> {
  const shared = await transaction.select({
    noteId: noteMemberships.noteId,
    userId: noteMemberships.userId,
    ownerUserId: notes.ownerUserId,
  }).from(noteMemberships).innerJoin(notes, eq(notes.id, noteMemberships.noteId)).where(and(
    inArray(notes.ownerUserId, [leftUserId, rightUserId]),
    inArray(noteMemberships.userId, [leftUserId, rightUserId]),
  ))
  const removable = shared.filter((row) => row.userId !== row.ownerUserId && (
    (row.ownerUserId === leftUserId && row.userId === rightUserId)
    || (row.ownerUserId === rightUserId && row.userId === leftUserId)
  ))
  if (removable.length) {
    await transaction.delete(noteMemberships).where(and(
      inArray(noteMemberships.noteId, removable.map((row) => row.noteId)),
      inArray(noteMemberships.userId, [leftUserId, rightUserId]),
      sql`${noteMemberships.role} <> 'owner'`,
    ))
  }
  return [...new Set(removable.map((row) => row.noteId))]
}

export async function markExpiredNotesForPurge(now = new Date(), userId?: string): Promise<number> {
  const rows = await db.select({ note: notes }).from(notes).where(and(
    isNotNull(notes.deletedAt),
    isNull(notes.purgeStartedAt),
    userId ? eq(notes.ownerUserId, userId) : undefined,
  ))
  const expired: string[] = []
  for (const row of rows) {
    if (!row.note.deletedAt) continue
    const retention = await getTrashRetention(row.note.ownerUserId)
    const purgeAt = purgeAtFor(row.note.deletedAt, retention)
    if (purgeAt && purgeAt <= now) expired.push(row.note.id)
  }
  if (!expired.length) return 0
  const marked = await db.update(notes).set({ purgeStartedAt: now, updatedAt: now })
    .where(and(inArray(notes.id, expired), isNull(notes.purgeStartedAt)))
    .returning({ id: notes.id })
  return marked.length
}

export async function purgePendingNotes(userId?: string): Promise<number> {
  const rows = await db.select({ id: notes.id }).from(notes).where(and(
    isNotNull(notes.purgeStartedAt),
    userId ? eq(notes.ownerUserId, userId) : undefined,
  ))
  let purged = 0
  let firstError: unknown
  for (const row of rows) {
    try {
      const files = await db.select({ objectKey: attachments.objectKey })
        .from(attachments).where(eq(attachments.noteId, row.id))
      await Promise.all(files.map((file) => getBlobStore().delete(file.objectKey)))
      await db.delete(notes).where(and(eq(notes.id, row.id), isNotNull(notes.purgeStartedAt)))
      purged += 1
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError) throw firstError
  return purged
}
