import { eq, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { userPreferences, users } from '../database/schema.js'
import { publishStateChange } from '../responses/events.js'
import { preferencesWithModelDefaults } from './model-preferences.js'

/**
 * Merges validated values into the account's preferences and tells the account's other sessions.
 * A change that depends on the saved values can compute the patch under the same lock.
 */
export async function patchAccountPreferences(
  userId: string,
  change: Record<string, unknown> | ((values: Record<string, unknown>) => Record<string, unknown> | undefined),
): Promise<Record<string, unknown>> {
  let stateRevision: number | undefined
  const values = await db.transaction(async (tx) => {
    // The same lock as the settings routes, so a stale full-document apply cannot undo this.
    await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
    let patch: Record<string, unknown> | undefined
    if (typeof change === 'function') {
      const [row] = await tx.select({ values: userPreferences.values }).from(userPreferences)
        .where(eq(userPreferences.userId, userId)).limit(1)
      const existing = (row?.values ?? {}) as Record<string, unknown>
      patch = change(existing)
      if (!patch) return existing
    } else {
      patch = change
    }
    const defaults = JSON.stringify(preferencesWithModelDefaults())
    const [saved] = await tx.insert(userPreferences).values({ userId, values: preferencesWithModelDefaults(patch) })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { values: sql`${defaults}::jsonb || ${userPreferences.values} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() },
      }).returning({ values: userPreferences.values })
    if (!saved) throw new Error('Could not save account preferences')
    const [revision] = await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
      .where(eq(users.id, userId)).returning({ revision: users.stateRevision })
    stateRevision = revision?.revision
    return saved.values as Record<string, unknown>
  })
  if (stateRevision !== undefined) await publishStateChange({ userId, revision: stateRevision })
  return values
}
