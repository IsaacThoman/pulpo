import type { DocClosedEvent } from '@pulpo/contracts'
import { redis } from '../redis.js'

export const DOC_CLOSED_CHANNEL = 'pulpo:file-doc-closed'
/** Document updates made outside a socket (agent edits in the worker), for open editors. */
export const DOC_UPDATE_CHANNEL = 'pulpo:file-doc-updates'

/** Every API instance relays a persisted update to its own sockets in the document's room. */
export async function publishDocUpdate(docId: string, update: Uint8Array): Promise<void> {
  await redis.publish(DOC_UPDATE_CHANNEL, JSON.stringify({ docId, update: Buffer.from(update).toString('base64') }))
}

/** Every API instance relays this to its own sockets in the documents' rooms. */
export async function publishDocsClosed(docIds: string[], reason: DocClosedEvent['reason']): Promise<void> {
  if (docIds.length) await redis.publish(DOC_CLOSED_CHANNEL, JSON.stringify({ docIds, reason }))
}
