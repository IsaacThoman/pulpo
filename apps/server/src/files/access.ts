import { and, eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { fileNodes } from '../database/schema.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type FileExecutor = typeof db | DatabaseTransaction
export type FileNodeRow = typeof fileNodes.$inferSelect

export interface FileAccess {
  node: FileNodeRow
  role: 'owner'
}

/**
 * The single authorization seam for Files: routes, realtime joins, and agent tools all resolve
 * access here. Only owners have access today; shared grants will extend this lookup.
 */
export async function resolveFileAccess(executor: FileExecutor, userId: string, nodeId: string): Promise<FileAccess | null> {
  const [node] = await executor.select().from(fileNodes)
    .where(and(eq(fileNodes.id, nodeId), eq(fileNodes.ownerUserId, userId))).limit(1)
  return node ? { node, role: 'owner' } : null
}
