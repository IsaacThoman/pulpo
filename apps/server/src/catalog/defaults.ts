import { isNull } from 'drizzle-orm'
import { db } from '../database/client.js'
import { labs, models } from '../database/schema.js'

export const INTERNAL_LAB_ID = '00000000-0000-7000-8000-000000000001'

export async function ensureBuiltinLabs(): Promise<void> {
  await db.insert(labs).values({
    id: INTERNAL_LAB_ID,
    name: 'Internal',
    logo: 'pulpo',
  }).onConflictDoNothing({ target: labs.id })

  await db.update(models).set({ labId: INTERNAL_LAB_ID }).where(isNull(models.labId))
}
