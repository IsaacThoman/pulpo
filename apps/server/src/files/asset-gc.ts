import { and, eq, lt, notInArray } from 'drizzle-orm'
import * as Y from 'yjs'
import type { LiveFormatCodec } from '@pulpo/client-core/office'
import type { db } from '../database/client.js'
import { fileChanges, fileDocAssets } from '../database/schema.js'
import { parseLiveSnapshot, readObject } from './agent/live.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Assets younger than this are kept even unreferenced: an editor may be about to refer to one it just uploaded. */
export const ASSET_GRACE_MS = 60 * 60_000

/**
 * Deletes the rows of a locked document's assets that neither the document nor a pending
 * proposal for it refers to, and returns their object keys for the caller to delete after commit.
 * Only formats whose codec lists its references (`referencedAssets`) are collected.
 */
export async function collectUnusedAssets(tx: DatabaseTransaction, nodeId: string, codec: LiveFormatCodec, doc: Y.Doc, now = new Date()): Promise<string[]> {
  if (!codec.referencedAssets) return []
  const referenced = new Set(codec.referencedAssets(doc))
  const proposals = await tx.select({ after: fileChanges.after }).from(fileChanges).where(and(
    eq(fileChanges.nodeId, nodeId), eq(fileChanges.mode, 'suggest'), eq(fileChanges.status, 'pending'),
  ))
  for (const { after } of proposals) {
    const forkKey = parseLiveSnapshot(after)?.forkKey
    if (!forkKey) continue
    const fork = new Y.Doc()
    Y.applyUpdate(fork, await readObject(forkKey))
    for (const hash of codec.referencedAssets(fork)) referenced.add(hash)
  }
  const unused = await tx.delete(fileDocAssets).where(and(
    eq(fileDocAssets.nodeId, nodeId),
    lt(fileDocAssets.createdAt, new Date(now.getTime() - ASSET_GRACE_MS)),
    ...referenced.size ? [notInArray(fileDocAssets.hash, [...referenced])] : [],
  )).returning({ objectKey: fileDocAssets.objectKey })
  return unused.map((row) => row.objectKey)
}
