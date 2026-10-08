import type { FollowedModelDefaults } from '@pulpo/contracts'
import type { AuthSettings } from './application-settings.js'
import { db } from '../database/client.js'
import { userPreferences } from '../database/schema.js'
import { preferencesWithModelDefaults } from './model-preferences.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export function newAccountModelReferenceIds(settings: AuthSettings): string[] {
  const { defaultModelId, favoriteModelIds } = settings.newAccountModelDefaults
  return [...new Set([
    ...(defaultModelId ? [defaultModelId] : []),
    ...favoriteModelIds,
  ])]
}

export function firstUnavailableModelReference(
  referencedModelIds: Iterable<string>,
  availableModelIds: Iterable<string>,
): string | null {
  const available = new Set(availableModelIds)
  return [...referencedModelIds].find((modelId) => !available.has(modelId)) ?? null
}

/** Fills model choices the account has not customized from the current new-account defaults. */
export function withNewAccountModelDefaults(
  values: Record<string, unknown>,
  settings: AuthSettings,
): { values: Record<string, unknown>; followedModelDefaults: FollowedModelDefaults } {
  const defaults = settings.newAccountModelDefaults
  const followedModelDefaults = {
    defaultModelId: values.defaultModelId == null,
    favoriteModelIds: values.favoriteModelIds == null,
  }
  return {
    values: {
      ...values,
      defaultModelId: followedModelDefaults.defaultModelId ? defaults.defaultModelId : values.defaultModelId,
      favoriteModelIds: followedModelDefaults.favoriteModelIds ? defaults.favoriteModelIds : values.favoriteModelIds,
    },
    followedModelDefaults,
  }
}

export async function insertNewAccountPreferences(
  transaction: DatabaseTransaction,
  userId: string,
): Promise<void> {
  await transaction.insert(userPreferences).values({
    userId,
    values: preferencesWithModelDefaults(),
  })
}
