import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import {
  applicationSettings,
  auditEvents,
  chats,
  dailyUsageRollups,
  generationAttempts,
  modelPresetChoices,
  modelPricingVersions,
  models,
  queuedMessages,
  requestLogs,
  responses,
  usageEvents,
  userPreferences,
} from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { authSettingsSchema, interfaceSettingsSchema, parseAuthSettings, parseOcrSettings } from '../settings/application-settings.js'
import { UNKNOWN_MODEL_ID } from './defaults.js'

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function removeDeletedModelPreferences(value: unknown, modelId: string): { changed: boolean; value: Record<string, unknown> } {
  const current = objectValue(value)
  const currentFavorites = Array.isArray(current.favoriteModelIds) ? current.favoriteModelIds : null
  const currentProviderOrder = Array.isArray(current.providerOrder) ? current.providerOrder : null
  const favoriteModelIds = currentFavorites?.filter((candidate) => candidate !== modelId)
  const providerOrder = currentProviderOrder?.filter((candidate) => candidate !== modelId)
  const generation = objectValue(current.generation)
  const hasGeneration = Object.hasOwn(generation, modelId)
  const { [modelId]: _deletedGeneration, ...remainingGeneration } = generation
  const changed = current.defaultModelId === modelId
    || favoriteModelIds !== undefined && favoriteModelIds.length !== currentFavorites?.length
    || providerOrder !== undefined && providerOrder.length !== currentProviderOrder?.length
    || hasGeneration
  if (!changed) return { changed: false, value: current }
  return {
    changed: true,
    value: {
      ...current,
      ...(current.defaultModelId === modelId ? { defaultModelId: null } : {}),
      ...(favoriteModelIds ? { favoriteModelIds } : {}),
      ...(providerOrder ? { providerOrder } : {}),
      ...(hasGeneration ? { generation: remainingGeneration } : {}),
    },
  }
}

export async function deleteCatalogModel(modelId: string, actorUserId: string): Promise<void> {
  if (modelId === UNKNOWN_MODEL_ID) throw new AppError(409, 'builtin_model', 'The unknown model placeholder cannot be deleted')

  await db.transaction(async (tx) => {
    const [model] = await tx.select({ id: models.id }).from(models).where(eq(models.id, modelId)).limit(1)
    if (!model) throw notFound('Model')

    const [activeResponse] = await tx.select({ id: responses.id }).from(responses).where(and(
      inArray(responses.status, ['queued', 'in_progress']),
      or(eq(responses.modelId, modelId), eq(responses.actualModelId, modelId)),
    )).limit(1)
    const [activeAttempt] = await tx.select({ id: generationAttempts.id }).from(generationAttempts).where(and(
      eq(generationAttempts.status, 'in_progress'),
      or(eq(generationAttempts.modelId, modelId), eq(generationAttempts.fallbackFromModelId, modelId)),
    )).limit(1)
    const [queuedMessage] = await tx.select({ id: queuedMessages.id }).from(queuedMessages).where(and(
      eq(queuedMessages.modelId, modelId),
      inArray(queuedMessages.status, ['editing', 'pending', 'dispatching']),
    )).limit(1)
    if (activeResponse || activeAttempt || queuedMessage) {
      throw new AppError(409, 'model_active', 'Wait for active and queued work to finish before deleting this model')
    }

    const pricingVersions = await tx.select({ id: modelPricingVersions.id }).from(modelPricingVersions)
      .where(eq(modelPricingVersions.modelId, modelId))
    const pricingVersionIds = pricingVersions.map((version) => version.id)
    if (pricingVersionIds.length) {
      await tx.update(responses).set({ pricingVersionId: null }).where(inArray(responses.pricingVersionId, pricingVersionIds))
      await tx.update(usageEvents).set({ pricingVersionId: null }).where(inArray(usageEvents.pricingVersionId, pricingVersionIds))
    }

    await tx.update(chats).set({ modelId: UNKNOWN_MODEL_ID }).where(eq(chats.modelId, modelId))
    await tx.update(responses).set({ modelId: UNKNOWN_MODEL_ID }).where(eq(responses.modelId, modelId))
    await tx.update(responses).set({ actualModelId: UNKNOWN_MODEL_ID }).where(eq(responses.actualModelId, modelId))
    await tx.update(queuedMessages).set({ modelId: UNKNOWN_MODEL_ID }).where(eq(queuedMessages.modelId, modelId))
    await tx.update(requestLogs).set({ requestedModelId: UNKNOWN_MODEL_ID }).where(eq(requestLogs.requestedModelId, modelId))
    await tx.update(requestLogs).set({ actualModelId: UNKNOWN_MODEL_ID }).where(eq(requestLogs.actualModelId, modelId))
    await tx.update(requestLogs).set({ currentModelId: UNKNOWN_MODEL_ID }).where(eq(requestLogs.currentModelId, modelId))
    await tx.update(generationAttempts).set({ modelId: UNKNOWN_MODEL_ID }).where(eq(generationAttempts.modelId, modelId))
    await tx.update(generationAttempts).set({ fallbackFromModelId: UNKNOWN_MODEL_ID }).where(eq(generationAttempts.fallbackFromModelId, modelId))
    await tx.update(usageEvents).set({ modelId: UNKNOWN_MODEL_ID }).where(eq(usageEvents.modelId, modelId))
    await tx.update(models).set({ fallbackModelId: null }).where(eq(models.fallbackModelId, modelId))

    await tx.execute(sql`
      insert into "daily_usage_rollups" ("day", "user_id", "model_id", "calls", "input_tokens", "output_tokens", "cost_micros")
      select "day", "user_id", ${UNKNOWN_MODEL_ID}, "calls", "input_tokens", "output_tokens", "cost_micros"
      from "daily_usage_rollups"
      where "model_id" = ${modelId}
      on conflict ("day", "user_id", "model_id") do update set
        "calls" = "daily_usage_rollups"."calls" + excluded."calls",
        "input_tokens" = "daily_usage_rollups"."input_tokens" + excluded."input_tokens",
        "output_tokens" = "daily_usage_rollups"."output_tokens" + excluded."output_tokens",
        "cost_micros" = "daily_usage_rollups"."cost_micros" + excluded."cost_micros"
    `)
    await tx.delete(dailyUsageRollups).where(eq(dailyUsageRollups.modelId, modelId))

    const preferences = await tx.select().from(userPreferences)
    for (const preference of preferences) {
      const replacement = removeDeletedModelPreferences(preference.values, modelId)
      if (replacement.changed) {
        await tx.update(userPreferences).set({ values: replacement.value, updatedAt: new Date() })
          .where(eq(userPreferences.userId, preference.userId))
      }
    }

    const settings = await tx.select().from(applicationSettings).where(inArray(applicationSettings.key, ['auth', 'interface', 'ocr']))
    for (const setting of settings) {
      if (setting.key === 'auth') {
        const value = parseAuthSettings(setting.value)
        const replacement = removeDeletedModelPreferences(value.newAccountModelDefaults, modelId)
        if (replacement.changed) {
          const next = authSettingsSchema.parse({ ...value, newAccountModelDefaults: replacement.value })
          await tx.update(applicationSettings).set({ value: next, updatedBy: actorUserId, updatedAt: new Date() })
            .where(eq(applicationSettings.key, setting.key))
        }
      } else if (setting.key === 'interface') {
        const parsed = interfaceSettingsSchema.safeParse(setting.value)
        const value = parsed.success ? parsed.data : interfaceSettingsSchema.parse({})
        if (value.localTask === modelId) {
          await tx.update(applicationSettings).set({ value: { ...value, localTask: 'current' }, updatedBy: actorUserId, updatedAt: new Date() })
            .where(eq(applicationSettings.key, setting.key))
        }
      } else {
        const value = parseOcrSettings(setting.value)
        if (value.modelId === modelId) {
          await tx.update(applicationSettings).set({ value: { ...value, enabled: false, modelId: null }, updatedBy: actorUserId, updatedAt: new Date() })
            .where(eq(applicationSettings.key, setting.key))
        }
      }
    }

    const redirects = await tx.select({ id: modelPresetChoices.id, action: modelPresetChoices.action })
      .from(modelPresetChoices).where(eq(modelPresetChoices.actionType, 'redirect'))
    for (const redirect of redirects) {
      if (objectValue(redirect.action).modelId === modelId) {
        await tx.update(modelPresetChoices).set({ actionType: 'none', action: {} }).where(eq(modelPresetChoices.id, redirect.id))
      }
    }

    const deleted = await tx.delete(models).where(eq(models.id, modelId)).returning({ id: models.id })
    if (!deleted.length) throw notFound('Model')
    await tx.insert(auditEvents).values({
      id: newId(), actorUserId, action: 'model.delete', targetType: 'model', targetId: modelId,
      metadata: { replacementModelId: UNKNOWN_MODEL_ID },
    })
  })
}
