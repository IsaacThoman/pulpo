import { db } from '../database/client.js'
import { models } from '../database/schema.js'

/** Display names for every catalog model; deleted models fall back to their id. */
export async function loadModelNames(): Promise<Record<string, string>> {
  const rows = await db.select({ id: models.id, name: models.name }).from(models)
  return Object.fromEntries(rows.map((row) => [row.id, row.name]))
}
