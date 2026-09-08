import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { responses } from '../database/schema.js'
import { codexEnabled, lockCodexPolicy } from './policy.js'

export async function startCodexGeneration(responseId: string): Promise<boolean | null> {
  return db.transaction(async (tx) => {
    await lockCodexPolicy(tx)
    const [response] = await tx.select({ status: responses.status }).from(responses)
      .where(eq(responses.id, responseId)).for('update').limit(1)
    if (!response) return null
    if (response.status === 'in_progress') return true
    if (response.status !== 'queued') return null
    if (!await codexEnabled(tx)) return false
    const now = new Date()
    await tx.update(responses).set({ status: 'in_progress', startedAt: now, updatedAt: now })
      .where(eq(responses.id, responseId))
    return true
  })
}
