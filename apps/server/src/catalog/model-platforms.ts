import { inArray, sql, type SQL } from 'drizzle-orm'
import { MODEL_UNAVAILABLE_ON_PLATFORM_ERROR, modelHiddenPlatformSchema, type ClientPlatform, type ModelHiddenPlatform } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { models } from '../database/schema.js'
import { AppError } from '../lib/errors.js'

type CatalogDatabase = Pick<typeof db, 'select'>

/** The native store app behind a request, or null for surfaces that never hide models. */
export function modelPlatformForClient(client: { platform: ClientPlatform } | null | undefined): ModelHiddenPlatform | null {
  return modelHiddenPlatformSchema.safeParse(client?.platform).data ?? null
}

export function isModelHiddenOnPlatform(model: { hiddenPlatforms: unknown }, platform: ModelHiddenPlatform | null): boolean {
  return platform !== null && Array.isArray(model.hiddenPlatforms) && model.hiddenPlatforms.includes(platform)
}

/** Catalog filter for models the platform may list; undefined leaves the query unfiltered. */
export function modelShownOnPlatformCondition(platform: ModelHiddenPlatform | null): SQL | undefined {
  return platform ? sql`not (${models.hiddenPlatforms} @> jsonb_build_array(${platform}::text))` : undefined
}

/**
 * Rejects requests from a store app that name a model hidden on that platform.
 * The client header is self-reported, so this keeps store builds compliant
 * rather than acting as an access control.
 */
export async function assertModelsAvailableOnPlatform(
  modelIds: Array<string | null | undefined>,
  client: { platform: ClientPlatform } | null | undefined,
  database: CatalogDatabase = db,
): Promise<void> {
  const platform = modelPlatformForClient(client)
  const ids = [...new Set(modelIds.filter((id): id is string => Boolean(id)))]
  if (!platform || !ids.length) return
  const rows = await database.select({ hiddenPlatforms: models.hiddenPlatforms }).from(models).where(inArray(models.id, ids))
  if (rows.some((row) => isModelHiddenOnPlatform(row, platform))) {
    throw new AppError(403, MODEL_UNAVAILABLE_ON_PLATFORM_ERROR, 'This model isn’t available in the mobile app. Choose another model to continue.', 'permission_error', 'model')
  }
}
