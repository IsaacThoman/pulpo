import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../database/client.js'
import { attachments, responses } from '../database/schema.js'
import { lineageFromLeaf } from '../messages/branching.js'
import { workspaceAttachments, type AttachmentPaths } from './workspace-attachments.js'

/** The files a reply's workspace starts with: this execution history's attachments, at the paths `paths` gives them. */
export async function loadWorkspaceAttachments(reply: { responseId: string; chatId: string; userId: string }, paths?: AttachmentPaths) {
  const turns = await db.select().from(responses).where(and(
    eq(responses.chatId, reply.chatId), eq(responses.userId, reply.userId), isNull(responses.deletedAt),
  )).orderBy(asc(responses.createdAt), asc(responses.id))
  const lineage = lineageFromLeaf(turns, reply.responseId)
  const rows = await db.select().from(attachments).where(and(
    eq(attachments.userId, reply.userId), eq(attachments.chatId, reply.chatId), eq(attachments.status, 'ready'),
  )).orderBy(asc(attachments.createdAt), asc(attachments.id))
  return workspaceAttachments(lineage, rows, paths)
}
