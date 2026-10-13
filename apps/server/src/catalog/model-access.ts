import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { MODEL_ACCESS_DENIED_ERROR } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { models, modelUserGrants, users } from '../database/schema.js'
import { AppError } from '../lib/errors.js'

type CatalogDatabase = Pick<typeof db, 'select'>

/** Catalog filter for models the user may list and use: unrestricted, granted, or any model for admins. */
export function modelAccessibleToUserCondition(userId: string): SQL {
  return sql`(
    not ${models.restricted}
    or exists (select 1 from ${modelUserGrants} where ${modelUserGrants.modelId} = ${models.id} and ${modelUserGrants.userId} = ${userId})
    or exists (select 1 from ${users} where ${users.id} = ${userId} and ${users.role} = 'admin')
  )`
}

/** Ids of restricted models the user cannot access. */
export async function inaccessibleModelIds(userId: string, database: CatalogDatabase = db): Promise<Set<string>> {
  const rows = await database.select({ id: models.id }).from(models)
    .where(and(eq(models.restricted, true), sql`not ${modelAccessibleToUserCondition(userId)}`))
  return new Set(rows.map((row) => row.id))
}

/** Rejects requests that name a restricted model the user has not been granted. */
export async function assertModelsAccessibleToUser(
  modelIds: Array<string | null | undefined>,
  userId: string,
  database: CatalogDatabase = db,
): Promise<void> {
  const ids = [...new Set(modelIds.filter((id): id is string => Boolean(id)))]
  if (!ids.length) return
  const [denied] = await database.select({ id: models.id }).from(models)
    .where(and(inArray(models.id, ids), sql`not ${modelAccessibleToUserCondition(userId)}`)).limit(1)
  if (denied) {
    throw new AppError(403, MODEL_ACCESS_DENIED_ERROR, 'You don’t have access to this model. Choose another model to continue.', 'permission_error', 'model')
  }
}
