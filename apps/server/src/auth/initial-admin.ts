import { eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { setupInputSchema } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { applicationSettings, passwordCredentials, users } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { newUserStorageLimit } from '../billing/storage-entitlements.js'
import { insertNewAccountPreferences } from '../settings/new-account-defaults.js'
import { parseAuthSettings } from '../settings/application-settings.js'
import { createPasswordHash, serializeUser } from './service.js'

type SetupInput = z.infer<typeof setupInputSchema>

export async function createInitialAdmin(input: SetupInput) {
  const userId = newId()
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1886747743)`)
    const [existingUser] = await tx.select({ id: users.id }).from(users).limit(1)
    if (existingUser) throw new AppError(409, 'setup_complete', 'Pulpo has already been set up')
    const [setting] = await tx.select({ value: applicationSettings.value }).from(applicationSettings)
      .where(eq(applicationSettings.key, 'auth')).limit(1)
    const authSettings = parseAuthSettings(setting?.value)
    await tx.insert(users).values({
      id: userId,
      email: input.email,
      name: input.name,
      username: input.username,
      role: 'admin',
      balanceMicros: 100_000_000,
      storageLimitBytes: await newUserStorageLimit(tx),
    })
    await tx.insert(passwordCredentials).values({
      userId,
      passwordHash: await createPasswordHash(input.password),
    })
    await insertNewAccountPreferences(tx, userId, authSettings)
  })
  const [created] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return serializeUser(created!)
}
