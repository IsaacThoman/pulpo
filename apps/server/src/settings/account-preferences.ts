import { eq, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { userPreferences, users } from '../database/schema.js'
import { publishStateChange } from '../responses/events.js'
import { preferencesWithModelDefaults } from './model-preferences.js'

/**
 * Merges validated values into the account's preferences, as `PATCH /api/settings` does, and tells
 * the account's other sessions. For changes the server makes on the user's behalf.
 */
export async function patchAccountPreferences(userId: string, patch: Record<string, unknown>): Promise<void> {
  let stateRevision: number | undefined
  await db.transaction(async (tx) => {
    // The same lock as the settings routes, so a stale full-document apply cannot undo this.
    await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
    const defaults = JSON.stringify(preferencesWithModelDefaults())
    await tx.insert(userPreferences).values({ userId, values: preferencesWithModelDefaults(patch) })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { values: sql`${defaults}::jsonb || ${userPreferences.values} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() },
      })
    const [revision] = await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
      .where(eq(users.id, userId)).returning({ revision: users.stateRevision })
    stateRevision = revision?.revision
  })
  if (stateRevision !== undefined) await publishStateChange({ userId, revision: stateRevision })
}
