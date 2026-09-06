import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { shelfMutationSchema, type ShelfMutation, type ShelfSnapshot } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { attachments, chats, shelvedDrafts, shelvedDraftAttachments, shelfOperations, users } from '../database/schema.js'
import { requireUser } from '../auth/service.js'
import { AppError, forbidden } from '../lib/errors.js'
import { publishStateChange } from '../responses/events.js'
import { accessibleChatCondition } from '../chats/temporary.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
async function readShelf(tx: Transaction, userId: string): Promise<ShelfSnapshot> {
  const [user] = await tx.select({ revision: users.stateRevision }).from(users).where(eq(users.id, userId))
  const rows = await tx.select().from(shelvedDrafts).where(and(eq(shelvedDrafts.userId, userId), isNull(shelvedDrafts.deletedAt)))
    .orderBy(asc(shelvedDrafts.position), asc(shelvedDrafts.id))
  return { revision: user!.revision, drafts: rows.map((row) => ({
    id: row.id, content: row.content, attachments: row.attachmentData, position: row.position,
    revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  })) }
}

export async function mutateShelf(userId: string, input: ShelfMutation): Promise<ShelfSnapshot> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-shelf:${userId}`}))`)
    const [receipt] = await tx.select().from(shelfOperations).where(and(eq(shelfOperations.userId, userId), eq(shelfOperations.operationId, input.operationId)))
    if (receipt) return { snapshot: await readShelf(tx, userId), changed: false }
    const rows = (await readShelf(tx, userId)).drafts
    const action = input.action
    let ids = rows.map((row) => row.id)
    const draft = action.type === 'save' ? action.draft : action.type === 'restore' ? action.replacement : undefined
    if (draft) {
      if (!draft.content.trim() && !draft.attachmentIds.length) throw new AppError(400, 'empty_draft', 'Add text or an attachment before shelving')
      const [existing] = await tx.select().from(shelvedDrafts).where(eq(shelvedDrafts.id, draft.id))
      if (existing && existing.userId !== userId) throw forbidden()
      if (!existing) {
        const attachmentIds = [...new Set(draft.attachmentIds)]
        const owned = attachmentIds.length ? await tx.select({ attachment: attachments }).from(attachments)
          .leftJoin(chats, eq(chats.id, attachments.chatId)).where(and(
            inArray(attachments.id, attachmentIds), eq(attachments.userId, userId), eq(attachments.status, 'ready'),
            or(isNull(attachments.chatId), and(isNull(chats.deletedAt), accessibleChatCondition())),
          )).for('update', { of: attachments }) : []
        if (owned.length !== attachmentIds.length) throw new AppError(409, 'attachment_unavailable', 'One or more attachments are unavailable')
        const byId = new Map(owned.map(({ attachment }) => [attachment.id, attachment]))
        const data = attachmentIds.map((id) => { const a = byId.get(id)!; return { id, name: a.originalName, mimeType: a.mimeType, size: a.sizeBytes } })
        // A shelf file can be restored into multiple working copies. Keep its
        // lifetime account-owned, so sending one copy cannot bind every copy
        // to that chat's eventual purge.
        if (attachmentIds.length) await tx.update(attachments).set({ chatId: null, shelvedAt: new Date(), updatedAt: new Date() })
          .where(inArray(attachments.id, attachmentIds))
        await tx.insert(shelvedDrafts).values({ id: draft.id, userId, content: draft.content, attachmentData: data })
        if (attachmentIds.length) await tx.insert(shelvedDraftAttachments).values(attachmentIds.map((attachmentId) => ({ draftId: draft.id, attachmentId })))
        if (action.type === 'restore' && ids.includes(action.id)) ids.splice(ids.indexOf(action.id), 0, draft.id)
        else ids.unshift(draft.id)
      }
    }
    if (action.type === 'restore' || action.type === 'delete') {
      await tx.insert(shelvedDrafts).values({ id: action.id, userId, content: '', deletedAt: new Date() }).onConflictDoNothing()
      await tx.update(shelvedDrafts).set({ deletedAt: new Date(), content: '', attachmentData: [], updatedAt: new Date() })
        .where(and(eq(shelvedDrafts.id, action.id), eq(shelvedDrafts.userId, userId)))
      // Ownership is checked through the parent, including on duplicate deletes.
      await tx.delete(shelvedDraftAttachments).where(and(eq(shelvedDraftAttachments.draftId, action.id),
        sql`exists (select 1 from ${shelvedDrafts} where ${shelvedDrafts.id} = ${action.id} and ${shelvedDrafts.userId} = ${userId})`))
      ids = ids.filter((id) => id !== action.id)
    }
    if (action.type === 'reorder' && action.id !== action.targetId && ids.includes(action.id) && ids.includes(action.targetId)) {
      ids = ids.filter((id) => id !== action.id)
      ids.splice(ids.indexOf(action.targetId) + (action.edge === 'after' ? 1 : 0), 0, action.id)
    }
    const [user] = await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` }).where(eq(users.id, userId)).returning({ revision: users.stateRevision })
    for (const [position, id] of ids.entries()) await tx.update(shelvedDrafts).set({ position, revision: user!.revision }).where(eq(shelvedDrafts.id, id))
    await tx.insert(shelfOperations).values({ userId, operationId: input.operationId })
    return { snapshot: await readShelf(tx, userId), changed: true }
  })
  // A retry also repairs a publication failure after an earlier commit.
  await publishStateChange({ userId, revision: result.snapshot.revision, scopes: ['shelved-drafts'] })
  return result.snapshot
}

export async function shelfAttachmentIsLive(userId: string, attachmentId: string, database: Pick<typeof db, 'select'> = db): Promise<boolean> {
  const [row] = await database.select({ id: shelvedDrafts.id }).from(shelvedDraftAttachments)
    .innerJoin(shelvedDrafts, eq(shelvedDrafts.id, shelvedDraftAttachments.draftId))
    .where(and(eq(shelvedDrafts.userId, userId), eq(shelvedDraftAttachments.attachmentId, attachmentId), isNull(shelvedDrafts.deletedAt))).limit(1)
  return Boolean(row)
}

export async function registerShelfRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/shelved-drafts', async (request) => {
    const user = requireUser(request)
    if (request.adminChatAccess) throw forbidden()
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-shelf:${user.id}`}))`)
      return readShelf(tx, user.id)
    })
  })
  app.post('/api/shelved-drafts', { bodyLimit: 4_100_000 }, async (request) => {
    const user = requireUser(request)
    if (request.adminChatAccess) throw forbidden()
    return mutateShelf(user.id, shelfMutationSchema.parse(request.body))
  })
}
