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

export function newAccountPreferenceValues(settings: AuthSettings): Record<string, unknown> {
  return preferencesWithModelDefaults({
    defaultModelId: settings.newAccountModelDefaults.defaultModelId,
    favoriteModelIds: settings.newAccountModelDefaults.favoriteModelIds,
  })
}

export async function insertNewAccountPreferences(
  transaction: DatabaseTransaction,
  userId: string,
  settings: AuthSettings,
): Promise<void> {
  await transaction.insert(userPreferences).values({
    userId,
    values: newAccountPreferenceValues(settings),
  })
}
