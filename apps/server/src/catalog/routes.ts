import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { chatPresetsSchema, createModelSchema, createProviderSchema, type ChatPreset } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { hasDatabaseErrorCode } from '../database/errors.js'
import {
  auditEvents,
  labs,
  modelPricingVersions,
  modelPresetChoices,
  modelPresets,
  models,
  providerConnections,
  providerHealthChecks,
  providerUpstreamModels,
  applicationSettings,
} from '../database/schema.js'
import { getConfig } from '../config.js'
import { decryptSecret, encryptSecret } from '../lib/crypto.js'
import { newId } from '../lib/ids.js'
import { requireAdmin, requireUser } from '../auth/service.js'
import { assertSafeProviderUrl } from '../lib/url-security.js'
import { AppError, notFound } from '../lib/errors.js'
import { INTERNAL_LAB_ID } from './defaults.js'
import { parseAgentSettings } from '../settings/application-settings.js'

type PresetInput = ChatPreset[]
const RESERVED_PARAMETERS = new Set(['model', 'input', 'stream', 'store', 'metadata'])

function validateDefaultParameters(value: Record<string, unknown>, allowedParameters: string[]): void {
  for (const key of Object.keys(value)) {
    if (RESERVED_PARAMETERS.has(key)) throw new AppError(400, 'reserved_parameter', `${key} is reserved and cannot be configured`)
    if (!allowedParameters.includes(key)) throw new AppError(400, 'parameter_not_allowed', `Default parameter ${key} is not allowed for this model`)
  }
}

async function validateFallback(modelId: string, fallbackModelId: string | null): Promise<void> {
  if (!fallbackModelId) return
  if (fallbackModelId === modelId) throw new AppError(409, 'fallback_cycle', 'A model cannot fall back to itself')
  const all = await db.select({ id: models.id, enabled: models.enabled, fallbackModelId: models.fallbackModelId }).from(models)
  const byId = new Map(all.map((model) => [model.id, model]))
  const target = byId.get(fallbackModelId)
  if (!target?.enabled) throw new AppError(409, 'fallback_unavailable', 'Fallback models must exist and be enabled')
  const seen = new Set([modelId])
  let cursor: string | null = fallbackModelId
  for (let depth = 0; cursor; depth += 1) {
    if (depth >= 8) throw new AppError(409, 'fallback_chain_too_deep', 'Fallback chains may contain at most eight models')
    if (seen.has(cursor)) throw new AppError(409, 'fallback_cycle', 'Fallback models cannot contain a cycle')
    seen.add(cursor)
    cursor = byId.get(cursor)?.fallbackModelId ?? null
  }
}

async function nextModelSortOrder(labId: string): Promise<number> {
  const [row] = await db.select({
    nextSortOrder: sql<number>`coalesce(max(${models.sortOrder}), -1)::int + 1`,
  }).from(models).where(eq(models.labId, labId))
  return row?.nextSortOrder ?? 0
}

async function validatePresets(modelId: string, presets: PresetInput, allowedParameters: string[]): Promise<void> {
  const reserved = allowedParameters.find((key) => RESERVED_PARAMETERS.has(key))
  if (reserved) throw new AppError(400, 'reserved_parameter', `${reserved} is reserved and cannot be configured`)
  for (const preset of presets) {
    if (preset.defaultChoiceId && !preset.choices.some((choice) => choice.id === preset.defaultChoiceId)) {
      throw new AppError(400, 'invalid_preset_default', `Preset ${preset.id} has an invalid default choice`)
    }
    for (const choice of preset.choices) {
      if (choice.action.type === 'params') {
        const invalid = Object.keys(choice.action.params).find((key) => !allowedParameters.includes(key))
        if (invalid) throw new AppError(400, 'parameter_not_allowed', `Preset parameter ${invalid} is not allowed for this model`)
      }
    }
  }
  const existingPresets = await db.select().from(modelPresets)
  const existingChoices = await db.select().from(modelPresetChoices)
  const ownerByPreset = new Map(existingPresets.map((preset) => [preset.id, preset.modelId]))
  const graph = new Map<string, Set<string>>()
  for (const choice of existingChoices) {
    const owner = ownerByPreset.get(choice.presetId)
    const action = choice.action as { modelId?: string }
    if (owner && owner !== modelId && choice.actionType === 'redirect' && action.modelId) {
      const edges = graph.get(owner) ?? new Set<string>(); edges.add(action.modelId); graph.set(owner, edges)
    }
  }
  for (const preset of presets) for (const choice of preset.choices) if (choice.action.type === 'redirect') {
    const [target] = await db.select({ id: models.id }).from(models).where(eq(models.id, choice.action.modelId)).limit(1)
    if (!target && choice.action.modelId !== modelId) throw new AppError(400, 'redirect_model_missing', `Redirect model ${choice.action.modelId} does not exist`)
    const edges = graph.get(modelId) ?? new Set<string>(); edges.add(choice.action.modelId); graph.set(modelId, edges)
  }
  const visiting = new Set<string>(); const visited = new Set<string>()
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true
    if (visited.has(node)) return false
    visiting.add(node)
    for (const next of graph.get(node) ?? []) if (visit(next)) return true
    visiting.delete(node); visited.add(node); return false
  }
  if ([...graph.keys()].some(visit)) throw new AppError(409, 'preset_redirect_cycle', 'Preset redirects cannot contain a cycle')
}

async function replacePresets(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], modelId: string, presets: PresetInput): Promise<void> {
  await tx.delete(modelPresets).where(eq(modelPresets.modelId, modelId))
  for (const [presetIndex, preset] of presets.entries()) {
    const presetId = newId()
    await tx.insert(modelPresets).values({ id: presetId, modelId, publicId: preset.id, name: preset.name, icon: preset.icon, sortOrder: presetIndex })
    let defaultChoiceUuid: string | null = null
    for (const [choiceIndex, choice] of preset.choices.entries()) {
      const choiceId = newId()
      if (choice.id === preset.defaultChoiceId) defaultChoiceUuid = choiceId
      const { type, ...action } = choice.action
      await tx.insert(modelPresetChoices).values({
        id: choiceId, presetId, publicId: choice.id, displayName: choice.displayName, icon: choice.icon,
        actionType: type, action, sortOrder: choiceIndex,
      })
    }
    if (defaultChoiceUuid) await tx.update(modelPresets).set({ defaultChoiceId: defaultChoiceUuid }).where(eq(modelPresets.id, presetId))
  }
}

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/models', async (request) => {
    requireUser(request)
    const rows = await db
      .select({ model: models, pricing: modelPricingVersions, lab: labs, provider: providerConnections })
      .from(models)
      .leftJoin(modelPricingVersions, and(
        eq(models.id, modelPricingVersions.modelId),
        isNull(modelPricingVersions.effectiveTo),
      ))
      .leftJoin(labs, eq(models.labId, labs.id))
      .innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id))
      .where(and(eq(models.enabled, true), eq(models.visible, true)))
      .orderBy(asc(models.sortOrder), asc(models.createdAt))
    const [agentRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
    const agentAvailable = parseAgentSettings(agentRow?.value).enabled && Boolean(getConfig().WORKSPACE_CONTROLLER_URL && getConfig().WORKSPACE_CONTROLLER_TOKEN)
    return { agentAvailable, data: await Promise.all(rows.map(async ({ model, pricing, lab, provider }) => ({
      id: model.id,
      upstreamModelId: model.upstreamModelId,
      name: model.name,
      description: model.description,
      enabled: model.enabled,
      visible: model.visible,
      logo: model.logo,
      executionMode: model.executionMode,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      inputPriceMicros: pricing?.inputPriceMicros ?? 0,
      cachedInputPriceMicros: pricing?.cachedInputPriceMicros ?? 0,
      outputPriceMicros: pricing?.outputPriceMicros ?? 0,
      perRequestPriceMicros: pricing?.perRequestPriceMicros ?? 0,
      tags: model.tags,
      agentEnabled: model.agentEnabled,
      provider: { id: provider.id, name: provider.name },
      lab: lab ? { id: lab.id, name: lab.name, logo: lab.logo } : null,
      iconLight: model.iconLight,
      iconDark: model.iconDark,
      presets: await Promise.all((await db.select().from(modelPresets).where(eq(modelPresets.modelId, model.id)).orderBy(modelPresets.sortOrder)).map(async (preset) => ({
        id: preset.publicId, name: preset.name, icon: preset.icon,
        defaultChoiceId: preset.defaultChoiceId
          ? (await db.select({ publicId: modelPresetChoices.publicId })
            .from(modelPresetChoices)
            .where(eq(modelPresetChoices.id, preset.defaultChoiceId))
            .limit(1))[0]?.publicId ?? null
          : null,
        choices: (await db.select().from(modelPresetChoices).where(eq(modelPresetChoices.presetId, preset.id)).orderBy(modelPresetChoices.sortOrder)).map((choice) => ({
          id: choice.publicId, displayName: choice.displayName, icon: choice.icon,
          action: { type: choice.actionType, ...(choice.action as Record<string, unknown>) },
        })),
      }))),
    }))) }
  })

  app.get('/api/admin/providers', async (request) => {
    requireAdmin(request)
    const rows = await db.select().from(providerConnections)
    return { data: rows.map(({ encryptedApiKey: _, ...row }) => ({ ...row, hasApiKey: true })) }
  })

  app.post('/api/admin/providers', async (request, reply) => {
    const admin = requireAdmin(request)
    const input = createProviderSchema.parse(request.body)
    await assertSafeProviderUrl(input.baseUrl)
    const id = newId()
    await db.transaction(async (tx) => {
      await tx.insert(providerConnections).values({
        id,
        name: input.name,
        baseUrl: input.baseUrl,
        encryptedApiKey: encryptSecret(input.apiKey, getConfig().ENCRYPTION_KEY),
        organizationId: input.organizationId,
        projectId: input.projectId,
        requestTimeoutMs: input.requestTimeoutMs,
      })
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'provider.create', targetType: 'provider', targetId: id,
      })
    })
    reply.code(201)
    return { id }
  })

  app.patch('/api/admin/providers/:id', async (request) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const body = request.body as { name?: string; baseUrl?: string; apiKey?: string; organizationId?: string | null; projectId?: string | null; requestTimeoutMs?: number; enabled?: boolean }
    if (body.requestTimeoutMs !== undefined && (body.requestTimeoutMs < 1_000 || body.requestTimeoutMs > 900_000)) throw new AppError(400, 'validation_error', 'Invalid provider configuration')
    if (body.baseUrl) await assertSafeProviderUrl(body.baseUrl)
    const [updated] = await db.update(providerConnections).set({
      name: body.name, baseUrl: body.baseUrl,
      encryptedApiKey: body.apiKey ? encryptSecret(body.apiKey, getConfig().ENCRYPTION_KEY) : undefined,
      organizationId: body.organizationId, projectId: body.projectId,
      requestTimeoutMs: body.requestTimeoutMs, enabled: body.enabled, updatedAt: new Date(),
    }).where(eq(providerConnections.id, id)).returning()
    if (!updated) throw notFound('Provider')
    await db.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'provider.update', targetType: 'provider', targetId: id })
    const { encryptedApiKey: _, ...safe } = updated
    return { ...safe, hasApiKey: true }
  })

  app.post('/api/admin/providers/:id/health', async (request) => {
    requireAdmin(request)
    const { id } = request.params as { id: string }
    const [provider] = await db.select().from(providerConnections).where(eq(providerConnections.id, id)).limit(1)
    if (!provider) throw notFound('Provider')
    await assertSafeProviderUrl(provider.baseUrl)
    const started = Date.now()
    let success = false
    let error: string | null = null
    try {
      const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/models`, {
        headers: { authorization: `Bearer ${decryptSecret(provider.encryptedApiKey, getConfig().ENCRYPTION_KEY)}` },
        signal: AbortSignal.timeout(provider.requestTimeoutMs),
      })
      success = response.ok
      if (!success) error = `OpenAI returned ${response.status}`
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Health check failed'
    }
    const latencyMs = Date.now() - started
    await db.transaction(async (tx) => {
      await tx.insert(providerHealthChecks).values({ id: newId(), providerConnectionId: id, success, latencyMs, error })
      await tx.update(providerConnections).set({ lastHealthStatus: success ? 'healthy' : 'unhealthy', lastHealthAt: new Date() }).where(eq(providerConnections.id, id))
    })
    return { success, latencyMs, error }
  })

  app.get('/api/admin/providers/:id/models', async (request) => {
    requireAdmin(request)
    const { id } = request.params as { id: string }
    const [provider] = await db.select({
      id: providerConnections.id,
      upstreamModelsSyncedAt: providerConnections.upstreamModelsSyncedAt,
    }).from(providerConnections).where(eq(providerConnections.id, id)).limit(1)
    if (!provider) throw notFound('Provider')
    const rows = await db.select({ modelId: providerUpstreamModels.modelId })
      .from(providerUpstreamModels)
      .where(eq(providerUpstreamModels.providerConnectionId, id))
      .orderBy(asc(providerUpstreamModels.modelId))
    return {
      data: rows.map((row) => row.modelId),
      syncedAt: provider.upstreamModelsSyncedAt,
    }
  })

  app.post('/api/admin/providers/:id/models/refresh', async (request) => {
    requireAdmin(request)
    const { id } = request.params as { id: string }
    const [provider] = await db.select().from(providerConnections).where(eq(providerConnections.id, id)).limit(1)
    if (!provider) throw notFound('Provider')
    await assertSafeProviderUrl(provider.baseUrl)
    let response: Response
    try {
      response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/models`, {
        headers: { authorization: `Bearer ${decryptSecret(provider.encryptedApiKey, getConfig().ENCRYPTION_KEY)}` },
        signal: AbortSignal.timeout(provider.requestTimeoutMs),
      })
    } catch (cause) {
      throw new AppError(502, 'upstream_unreachable', cause instanceof Error ? cause.message : 'Failed to reach provider /models')
    }
    if (!response.ok) {
      throw new AppError(502, 'upstream_error', `Provider /models returned ${response.status}`)
    }
    const payload = await response.json() as { data?: Array<{ id?: unknown }> }
    if (!Array.isArray(payload?.data)) {
      throw new AppError(502, 'upstream_invalid', 'Provider /models response missing data array')
    }
    const modelIds = [...new Set(
      payload.data
        .map((item) => (typeof item?.id === 'string' ? item.id.trim() : ''))
        .filter(Boolean),
    )].sort((a, b) => a.localeCompare(b))
    const syncedAt = new Date()
    await db.transaction(async (tx) => {
      await tx.delete(providerUpstreamModels).where(eq(providerUpstreamModels.providerConnectionId, id))
      if (modelIds.length) {
        await tx.insert(providerUpstreamModels).values(
          modelIds.map((modelId) => ({ providerConnectionId: id, modelId })),
        )
      }
      await tx.update(providerConnections).set({
        upstreamModelsSyncedAt: syncedAt,
        updatedAt: syncedAt,
      }).where(eq(providerConnections.id, id))
    })
    return { data: modelIds, syncedAt }
  })

  app.delete('/api/admin/providers/:id', async (request, reply) => {
    requireAdmin(request)
    const { id } = request.params as { id: string }
    const used = await db.select({ id: models.id }).from(models).where(eq(models.providerConnectionId, id)).limit(1)
    if (used.length) throw new AppError(409, 'provider_in_use', 'Delete or move this provider’s models first')
    const deleted = await db.delete(providerConnections).where(eq(providerConnections.id, id)).returning({ id: providerConnections.id })
    if (!deleted.length) throw notFound('Provider')
    reply.code(204).send()
  })

  app.get('/api/admin/labs', async (request) => {
    requireAdmin(request)
    const [labRows, modelRows] = await Promise.all([
      db.select().from(labs).orderBy(labs.createdAt),
      db.select({
        id: models.id,
        labId: models.labId,
        name: models.name,
        logo: models.logo,
        enabled: models.enabled,
        visible: models.visible,
        sortOrder: models.sortOrder,
      }).from(models).orderBy(asc(models.sortOrder), asc(models.createdAt)),
    ])
    return { data: labRows.map((lab) => {
      const labModels = modelRows.filter((model) => model.labId === lab.id)
      return {
      ...lab,
      models: labModels,
      modelCount: labModels.length,
      builtin: lab.id === INTERNAL_LAB_ID,
      }
    }) }
  })

  app.post('/api/admin/labs', async (request, reply) => {
    requireAdmin(request)
    const input = request.body as { name?: string; logo?: string }
    if (!input.name?.trim() || !input.logo?.trim()) throw new AppError(400, 'validation_error', 'Lab name and logo are required')
    const [created] = await db.insert(labs).values({ id: newId(), name: input.name.trim(), logo: input.logo.trim() }).returning()
    reply.code(201)
    return created
  })

  app.patch('/api/admin/labs/:id', async (request) => {
    requireAdmin(request)
    const { id } = request.params as { id: string }
    if (id === INTERNAL_LAB_ID) throw new AppError(409, 'builtin_lab', 'The Internal lab cannot be edited')
    const body = request.body as { name?: string; logo?: string }
    const [updated] = await db.update(labs).set({ name: body.name?.trim(), logo: body.logo?.trim(), updatedAt: new Date() }).where(eq(labs.id, id)).returning()
    if (!updated) throw notFound('Lab')
    return updated
  })

  app.put('/api/admin/labs/:id/models/order', async (request) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const { modelIds } = z.object({ modelIds: z.array(z.string()).max(1_000) }).parse(request.body)
    if (new Set(modelIds).size !== modelIds.length) {
      throw new AppError(400, 'validation_error', 'Model order cannot contain duplicates')
    }
    const existing = await db.select({ id: models.id }).from(models).where(eq(models.labId, id))
    const existingIds = new Set(existing.map((model) => model.id))
    if (modelIds.length !== existingIds.size || modelIds.some((modelId) => !existingIds.has(modelId))) {
      throw new AppError(400, 'validation_error', 'Model order must contain every model in the lab exactly once')
    }
    await db.transaction(async (tx) => {
      for (const [sortOrder, modelId] of modelIds.entries()) {
        await tx.update(models)
          .set({ sortOrder, updatedAt: new Date() })
          .where(and(eq(models.id, modelId), eq(models.labId, id)))
      }
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'lab.models.reorder', targetType: 'lab', targetId: id,
      })
    })
    return { data: modelIds }
  })

  app.delete('/api/admin/labs/:id', async (request, reply) => {
    requireAdmin(request)
    const { id } = request.params as { id: string }
    if (id === INTERNAL_LAB_ID) throw new AppError(409, 'builtin_lab', 'The Internal lab cannot be deleted')
    const deleted = await db.transaction(async (tx) => {
      await tx.update(models).set({ labId: INTERNAL_LAB_ID, updatedAt: new Date() }).where(eq(models.labId, id))
      return tx.delete(labs).where(eq(labs.id, id)).returning({ id: labs.id })
    })
    if (!deleted.length) throw notFound('Lab')
    reply.code(204).send()
  })

  app.get('/api/admin/models', async (request) => {
    requireAdmin(request)
    const rows = await db.select({ model: models, pricing: modelPricingVersions }).from(models)
      .leftJoin(modelPricingVersions, and(eq(models.id, modelPricingVersions.modelId), isNull(modelPricingVersions.effectiveTo)))
      .orderBy(asc(models.sortOrder), asc(models.createdAt))
    return { data: await Promise.all(rows.map(async ({ model, pricing }) => ({
      ...model,
      inputPriceMicros: pricing?.inputPriceMicros ?? 0,
      cachedInputPriceMicros: pricing?.cachedInputPriceMicros ?? 0,
      outputPriceMicros: pricing?.outputPriceMicros ?? 0,
      perRequestPriceMicros: pricing?.perRequestPriceMicros ?? 0,
      presets: await Promise.all((await db.select().from(modelPresets).where(eq(modelPresets.modelId, model.id)).orderBy(modelPresets.sortOrder)).map(async (preset) => ({
        id: preset.publicId, name: preset.name, icon: preset.icon,
        defaultChoiceId: preset.defaultChoiceId ? (await db.select({ publicId: modelPresetChoices.publicId }).from(modelPresetChoices).where(eq(modelPresetChoices.id, preset.defaultChoiceId)).limit(1))[0]?.publicId ?? null : null,
        choices: (await db.select().from(modelPresetChoices).where(eq(modelPresetChoices.presetId, preset.id)).orderBy(modelPresetChoices.sortOrder)).map((choice) => ({
          id: choice.publicId, displayName: choice.displayName, icon: choice.icon,
          action: { type: choice.actionType, ...(choice.action as Record<string, unknown>) },
        })),
      }))),
    }))) }
  })

  app.post('/api/admin/models', async (request, reply) => {
    const admin = requireAdmin(request)
    const raw = z.object({ presets: chatPresetsSchema.default([]) }).passthrough().parse(request.body)
    const input = createModelSchema.parse(raw)
    validateDefaultParameters(input.defaultParameters, input.allowedParameters)
    await validateFallback(input.id, input.fallbackModelId)
    await validatePresets(input.id, raw.presets, input.allowedParameters)
    const pricingId = newId()
    const labId = input.labId ?? INTERNAL_LAB_ID
    const sortOrder = await nextModelSortOrder(labId)
    await db.transaction(async (tx) => {
      await tx.insert(models).values({
        id: input.id,
        providerConnectionId: input.providerConnectionId,
        labId,
        upstreamModelId: input.upstreamModelId,
        name: input.name,
        description: input.description,
        sortOrder,
        enabled: input.enabled,
        visible: input.visible,
        logo: input.logo,
        systemPrompt: input.systemPrompt,
        agentEnabled: input.agentEnabled,
        agentInstructions: input.agentInstructions,
        defaultParameters: input.defaultParameters,
        interceptImagesWithOcr: input.interceptImagesWithOcr,
        contextWindow: input.contextWindow,
        maxOutputTokens: input.maxOutputTokens,
        compactionEnabled: input.compactionEnabled,
        compactionThresholdTokens: input.compactionThresholdTokens,
        agentCompactionThresholdTokens: input.agentCompactionThresholdTokens,
        compactionRetainedTurns: input.compactionRetainedTurns,
        executionMode: input.executionMode,
        tags: input.tags,
        allowedParameters: input.allowedParameters,
        useProviderCost: input.useProviderCost,
        fallbackModelId: input.fallbackModelId,
        maxRetries: input.maxRetries,
        retryDelaySeconds: input.retryDelaySeconds,
        stickyFallbackSeconds: input.stickyFallbackSeconds,
        firstTokenTimeoutEnabled: input.firstTokenTimeoutEnabled,
        firstTokenTimeoutSeconds: input.firstTokenTimeoutSeconds,
        slowStickyEnabled: input.slowStickyEnabled,
        slowStickyMinTokensPerSecond: input.slowStickyMinTokensPerSecond,
        slowStickyMinCompletionSeconds: input.slowStickyMinCompletionSeconds,
      })
      await tx.insert(modelPricingVersions).values({
        id: pricingId,
        modelId: input.id,
        inputPriceMicros: input.inputPriceMicros,
        cachedInputPriceMicros: input.cachedInputPriceMicros,
        outputPriceMicros: input.outputPriceMicros,
        perRequestPriceMicros: input.perRequestPriceMicros,
      })
      await replacePresets(tx, input.id, raw.presets)
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'model.create', targetType: 'model', targetId: input.id,
      })
    })
    reply.code(201)
    return { id: input.id, pricingVersionId: pricingId }
  })

  app.patch('/api/admin/models/:id', async (request) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    const compactionPatch = z.object({
      compactionEnabled: z.boolean().optional(),
      compactionThresholdTokens: z.number().int().min(2_000).max(1_000_000).optional(),
      agentCompactionThresholdTokens: z.number().int().min(2_000).max(1_000_000).optional(),
      compactionRetainedTurns: z.number().int().min(1).max(32).optional(),
    }).parse(body)
    const [current] = await db.select().from(models).where(eq(models.id, id)).limit(1)
    if (!current) throw notFound('Model')
    const parsedPresets = body.presets === undefined ? undefined : chatPresetsSchema.parse(body.presets)
    const effectiveAllowed = Array.isArray(body.allowedParameters) ? body.allowedParameters.filter((value): value is string => typeof value === 'string') : current.allowedParameters as string[]
    const effectiveDefaults = body.defaultParameters && typeof body.defaultParameters === 'object' && !Array.isArray(body.defaultParameters) ? body.defaultParameters as Record<string, unknown> : current.defaultParameters as Record<string, unknown>
    validateDefaultParameters(effectiveDefaults, effectiveAllowed)
    if (parsedPresets) await validatePresets(id, parsedPresets, effectiveAllowed)
    if (body.fallbackModelId !== undefined) await validateFallback(id, typeof body.fallbackModelId === 'string' ? body.fallbackModelId : null)
    const currentLabId = current.labId ?? INTERNAL_LAB_ID
    const requestedLabId = typeof body.labId === 'string' ? body.labId : body.labId === null ? INTERNAL_LAB_ID : currentLabId
    const labChanged = requestedLabId !== currentLabId
    const sortOrder = labChanged ? await nextModelSortOrder(requestedLabId) : current.sortOrder
    const [updated] = await db.update(models).set({
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      upstreamModelId: typeof body.upstreamModelId === 'string' ? body.upstreamModelId : undefined,
      providerConnectionId: typeof body.providerConnectionId === 'string' ? body.providerConnectionId : undefined,
      labId: labChanged ? requestedLabId : undefined,
      sortOrder: labChanged ? sortOrder : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      visible: typeof body.visible === 'boolean' ? body.visible : undefined,
      logo: typeof body.logo === 'string' ? body.logo : body.logo === null ? null : undefined,
      systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
      agentEnabled: typeof body.agentEnabled === 'boolean' ? body.agentEnabled : undefined,
      agentInstructions: typeof body.agentInstructions === 'string' ? body.agentInstructions : undefined,
      defaultParameters: body.defaultParameters && typeof body.defaultParameters === 'object' ? body.defaultParameters : undefined,
      interceptImagesWithOcr: typeof body.interceptImagesWithOcr === 'boolean' ? body.interceptImagesWithOcr : undefined,
      contextWindow: typeof body.contextWindow === 'number' ? body.contextWindow : undefined,
      maxOutputTokens: typeof body.maxOutputTokens === 'number' ? body.maxOutputTokens : undefined,
      compactionEnabled: compactionPatch.compactionEnabled,
      compactionThresholdTokens: compactionPatch.compactionThresholdTokens,
      agentCompactionThresholdTokens: compactionPatch.agentCompactionThresholdTokens,
      compactionRetainedTurns: compactionPatch.compactionRetainedTurns,
      executionMode: body.executionMode === 'background' ? 'background' : body.executionMode === 'stream' ? 'stream' : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      allowedParameters: Array.isArray(body.allowedParameters) ? body.allowedParameters : undefined,
      useProviderCost: typeof body.useProviderCost === 'boolean' ? body.useProviderCost : undefined,
      fallbackModelId: typeof body.fallbackModelId === 'string' ? body.fallbackModelId : body.fallbackModelId === null ? null : undefined,
      maxRetries: typeof body.maxRetries === 'number' ? body.maxRetries : undefined,
      retryDelaySeconds: typeof body.retryDelaySeconds === 'number' ? body.retryDelaySeconds : undefined,
      stickyFallbackSeconds: typeof body.stickyFallbackSeconds === 'number' ? body.stickyFallbackSeconds : undefined,
      firstTokenTimeoutEnabled: typeof body.firstTokenTimeoutEnabled === 'boolean' ? body.firstTokenTimeoutEnabled : undefined,
      firstTokenTimeoutSeconds: typeof body.firstTokenTimeoutSeconds === 'number' ? body.firstTokenTimeoutSeconds : undefined,
      slowStickyEnabled: typeof body.slowStickyEnabled === 'boolean' ? body.slowStickyEnabled : undefined,
      slowStickyMinTokensPerSecond: typeof body.slowStickyMinTokensPerSecond === 'number' ? body.slowStickyMinTokensPerSecond : undefined,
      slowStickyMinCompletionSeconds: typeof body.slowStickyMinCompletionSeconds === 'number' ? body.slowStickyMinCompletionSeconds : undefined,
      updatedAt: new Date(),
    }).where(eq(models.id, id)).returning()
    if (['inputPriceMicros', 'cachedInputPriceMicros', 'outputPriceMicros', 'perRequestPriceMicros'].some((key) => typeof body[key] === 'number')) {
      await db.update(modelPricingVersions).set({ effectiveTo: new Date() }).where(and(eq(modelPricingVersions.modelId, id), isNull(modelPricingVersions.effectiveTo)))
      await db.insert(modelPricingVersions).values({
        id: newId(), modelId: id,
        inputPriceMicros: Number(body.inputPriceMicros ?? 0), cachedInputPriceMicros: Number(body.cachedInputPriceMicros ?? 0),
        outputPriceMicros: Number(body.outputPriceMicros ?? 0), perRequestPriceMicros: Number(body.perRequestPriceMicros ?? 0),
      })
    }
    if (parsedPresets) await db.transaction((tx) => replacePresets(tx, id, parsedPresets))
    await db.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'model.update', targetType: 'model', targetId: id })
    return updated
  })

  app.delete('/api/admin/models/:id', async (request, reply) => {
    requireAdmin(request)
    const { id } = request.params as { id: string }
    let deleted: Array<{ id: string }>
    try {
      deleted = await db.delete(models).where(eq(models.id, id)).returning({ id: models.id })
    } catch (cause) {
      if (hasDatabaseErrorCode(cause, '23503')) {
        throw new AppError(409, 'model_in_use', 'This model has conversation or usage history; disable it instead')
      }
      throw cause
    }
    if (!deleted.length) throw notFound('Model')
    reply.code(204).send()
  })
}
