import type { DocClosedEvent } from '@pulpo/contracts'
import { redis } from '../redis.js'

export const DOC_CLOSED_CHANNEL = 'pulpo:file-doc-closed'

/** Every API instance relays this to its own sockets in the documents' rooms. */
export async function publishDocsClosed(docIds: string[], reason: DocClosedEvent['reason']): Promise<void> {
  if (docIds.length) await redis.publish(DOC_CLOSED_CHANNEL, JSON.stringify({ docIds, reason }))
}
