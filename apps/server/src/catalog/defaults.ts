import { UNKNOWN_MODEL_ID } from '@pulpo/contracts'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../database/client.js'
import { labs, modelPresetChoices, modelPresets, modelPricingVersions, models, providerConnections } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { CODEX_LAB_ID, CODEX_PROVIDER_ID, codexCatalogModelId } from '../codex/constants.js'

export const INTERNAL_LAB_ID = '00000000-0000-7000-8000-000000000001'
export const INTERNAL_PROVIDER_ID = '00000000-0000-7000-8000-000000000002'
export { UNKNOWN_MODEL_ID }

async function ensureCodexReasoningPreset(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], modelId: string, levels: string[]): Promise<void> {
  const [existing] = await tx.select({ id: modelPresets.id }).from(modelPresets)
    .where(and(eq(modelPresets.modelId, modelId), eq(modelPresets.publicId, 'reasoning'))).limit(1)
  const presetId = existing?.id ?? newId()
  if (!existing) await tx.insert(modelPresets).values({
    id: presetId, modelId, publicId: 'reasoning', name: 'Reasoning', icon: 'brain', sortOrder: 0,
  })
  let defaultChoiceId: string | null = null
  const existingChoices = await tx.select({ id: modelPresetChoices.id, publicId: modelPresetChoices.publicId })
    .from(modelPresetChoices).where(eq(modelPresetChoices.presetId, presetId))
  for (const choice of existingChoices) {
    if (!levels.includes(choice.publicId)) await tx.delete(modelPresetChoices).where(eq(modelPresetChoices.id, choice.id))
  }
  for (const [sortOrder, level] of levels.entries()) {
    const [choice] = await tx.select({ id: modelPresetChoices.id }).from(modelPresetChoices)
      .where(and(eq(modelPresetChoices.presetId, presetId), eq(modelPresetChoices.publicId, level))).limit(1)
    const id = choice?.id ?? newId()
    const values = {
      displayName: level === 'xhigh' ? 'Extra high' : level.charAt(0).toUpperCase() + level.slice(1),
      icon: 'brain', actionType: 'params', action: { params: { reasoning: { effort: level } } }, sortOrder,
    }
    if (choice) await tx.update(modelPresetChoices).set(values).where(eq(modelPresetChoices.id, id))
    else await tx.insert(modelPresetChoices).values({ id, presetId, publicId: level, ...values })
    if (level === 'medium' || (!defaultChoiceId && sortOrder === 0)) defaultChoiceId = id
  }
  await tx.update(modelPresets).set({ name: 'Reasoning', icon: 'brain', defaultChoiceId }).where(eq(modelPresets.id, presetId))
}

export async function ensureBuiltinCatalog(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(labs).values({
      id: INTERNAL_LAB_ID,
      name: 'Internal',
      logo: 'pulpo',
    }).onConflictDoNothing({ target: labs.id })

    await tx.insert(providerConnections).values({
      id: INTERNAL_PROVIDER_ID,
      name: 'Pulpo internal',
      baseUrl: 'http://127.0.0.1',
      encryptedApiKey: 'unused',
      enabled: false,
    }).onConflictDoUpdate({
      target: providerConnections.id,
      set: {
        name: 'Pulpo internal',
        baseUrl: 'http://127.0.0.1',
        encryptedApiKey: 'unused',
        enabled: false,
      },
    })

    await tx.insert(models).values({
      id: UNKNOWN_MODEL_ID,
      providerConnectionId: INTERNAL_PROVIDER_ID,
      labId: INTERNAL_LAB_ID,
      upstreamModelId: UNKNOWN_MODEL_ID,
      name: 'unknown model',
      description: 'Historical usage for a deleted model.',
      sortOrder: -1,
      enabled: false,
      visible: false,
      logo: 'pulpo',
      contextWindow: 1,
      maxOutputTokens: 1,
    }).onConflictDoUpdate({
      target: models.id,
      set: {
        providerConnectionId: INTERNAL_PROVIDER_ID,
        labId: INTERNAL_LAB_ID,
        upstreamModelId: UNKNOWN_MODEL_ID,
        name: 'unknown model',
        description: 'Historical usage for a deleted model.',
        sortOrder: -1,
        enabled: false,
        visible: false,
        logo: 'pulpo',
        contextWindow: 1,
        maxOutputTokens: 1,
        fallbackModelId: null,
      },
    })

    await tx.update(models).set({ labId: INTERNAL_LAB_ID }).where(isNull(models.labId))

    await tx.insert(labs).values({ id: CODEX_LAB_ID, name: 'Codex', logo: 'codex' }).onConflictDoUpdate({
      target: labs.id, set: { name: 'Codex', logo: 'codex', updatedAt: new Date() },
    })
    await tx.insert(providerConnections).values({
      id: CODEX_PROVIDER_ID,
      name: 'Codex subscription',
      type: 'codex_subscription',
      baseUrl: 'https://chatgpt.com/backend-api',
      encryptedApiKey: 'managed-oauth',
      cacheAffinityMode: 'prompt_cache_key',
      cacheAffinityScope: 'chat',
      enabled: true,
    }).onConflictDoUpdate({
      target: providerConnections.id,
      set: {
        name: 'Codex subscription', type: 'codex_subscription', baseUrl: 'https://chatgpt.com/backend-api',
        encryptedApiKey: 'managed-oauth', cacheAffinityMode: 'prompt_cache_key', cacheAffinityScope: 'chat', enabled: true,
        updatedAt: new Date(),
      },
    })

    await tx.update(models).set({ enabled: false, visible: false, updatedAt: new Date() })
      .where(eq(models.providerConnectionId, CODEX_PROVIDER_ID))
    const provider = openaiCodexProvider()
    for (const [sortOrder, upstream] of provider.getModels().entries()) {
      const id = codexCatalogModelId(upstream.id)
      await tx.insert(models).values({
        id, providerConnectionId: CODEX_PROVIDER_ID, labId: CODEX_LAB_ID, upstreamModelId: upstream.id,
        name: upstream.name, description: 'Use your ChatGPT Plus or Pro Codex subscription.', sortOrder,
        enabled: true, visible: true, logo: 'codex', agentEnabled: true, defaultParameters: { reasoning: { effort: 'medium' } },
        contextWindow: upstream.contextWindow, maxOutputTokens: upstream.maxTokens,
        tags: upstream.input.includes('image') ? ['reasoning', 'tools', 'code', 'vision'] : ['reasoning', 'tools', 'code'],
        allowedParameters: ['reasoning'], useProviderCost: false, fallbackModelId: null, maxRetries: 0,
      }).onConflictDoUpdate({
        target: models.id,
        set: {
          providerConnectionId: CODEX_PROVIDER_ID, labId: CODEX_LAB_ID, upstreamModelId: upstream.id,
          name: upstream.name, description: 'Use your ChatGPT Plus or Pro Codex subscription.', sortOrder,
          enabled: true, visible: true, logo: 'codex', agentEnabled: true,
          defaultParameters: { reasoning: { effort: 'medium' } },
          contextWindow: upstream.contextWindow, maxOutputTokens: upstream.maxTokens,
          tags: upstream.input.includes('image') ? ['reasoning', 'tools', 'code', 'vision'] : ['reasoning', 'tools', 'code'],
          allowedParameters: ['reasoning'], useProviderCost: false, fallbackModelId: null, maxRetries: 0, updatedAt: new Date(),
        },
      })
      const [pricing] = await tx.select({ id: modelPricingVersions.id }).from(modelPricingVersions)
        .where(and(eq(modelPricingVersions.modelId, id), isNull(modelPricingVersions.effectiveTo))).limit(1)
      if (pricing) await tx.update(modelPricingVersions).set({
        inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0, perRequestPriceMicros: 0,
      }).where(eq(modelPricingVersions.id, pricing.id))
      else await tx.insert(modelPricingVersions).values({
        id: newId(), modelId: id, inputPriceMicros: 0, cachedInputPriceMicros: 0,
        cacheWritePriceMicros: 0, outputPriceMicros: 0, perRequestPriceMicros: 0,
      })
      await ensureCodexReasoningPreset(tx, id, getSupportedThinkingLevels(upstream))
    }
  })
}
