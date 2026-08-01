import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { responseContentParts, responseItems } from '../database/schema.js'
import { newId } from '../lib/ids.js'

export async function persistResponseItems(responseId: string, output: unknown[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(responseItems).where(eq(responseItems.responseId, responseId))
    for (const [position, raw] of output.entries()) {
      const item = raw as { id?: string; type?: string; role?: string; status?: string; content?: unknown[] }
      const itemId = newId()
      await tx.insert(responseItems).values({ id: itemId, responseId, upstreamItemId: item.id, type: item.type ?? 'unknown', role: item.role, status: item.status, position, payload: raw })
      if (Array.isArray(item.content)) for (const [partPosition, part] of item.content.entries()) await tx.insert(responseContentParts).values({ id: newId(), responseItemId: itemId, type: (part as { type?: string }).type ?? 'unknown', position: partPosition, payload: part })
    }
  })
}
