import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createModelSchema, createProviderSchema } from '@pulpo/contracts'
import { db } from '../database/client.js'
import {
  auditEvents,
  labs,
  modelPricingVersions,
  modelPresetChoices,
  modelPresets,
  models,
  providerConnections,
  providerHealthChecks,
} from '../database/schema.js'
import { getConfig } from '../config.js'
import { decryptSecret, encryptSecret } from '../lib/crypto.js'
import { newId } from '../lib/ids.js'
import { requireAdmin, requireUser } from '../auth/service.js'
import { assertSafeProviderUrl } from '../lib/url-security.js'
import { AppError, notFound } from '../lib/errors.js'

const presetSchema = z.array(z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
  name: z.string().trim().min(1).max(80),
  icon: z.string().min(1).max(80),
  defaultChoiceId: z.string().nullable().optional(),
  choices: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    displayName: z.string().trim().min(1).max(80),
    icon: z.string().max(80).nullable().optional(),
    action: z.discriminatedUnion('type', [
      z.object({ type: z.literal('none') }),
      z.object({ type: z.literal('redirect'), modelId: z.string().min(1).max(120) }),
      z.object({ type: z.literal('params'), params: z.record(z.string(), z.unknown()) }),
    ]),
  })).min(1).max(20),
})).max(10)

type PresetInput = z.infer<typeof presetSchema>

async function validatePresets(modelId: string, presets: PresetInput, allowedParameters: string[]): Promise<void> {
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
      .where(eq(models.enabled, true))
    return { data: await Promise.all(rows.map(async ({ model, pricing, lab, provider }) => ({
      id: model.id,
      upstreamModelId: model.upstreamModelId,
      name: model.name,
      description: model.description,
      enabled: model.enabled,
      executionMode: model.executionMode,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      inputPriceMicros: pricing?.inputPriceMicros ?? 0,
      cachedInputPriceMicros: pricing?.cachedInputPriceMicros ?? 0,
      outputPriceMicros: pricing?.outputPriceMicros ?? 0,
      perRequestPriceMicros: pricing?.perRequestPriceMicros ?? 0,
      tags: model.tags,
      provider: { id: provider.id, name: provider.name },
      lab: lab ? { id: lab.id, name: lab.name, logo: lab.logo } : null,
      iconLight: model.iconLight,
      iconDark: model.iconDark,
      presets: await Promise.all((await db.select().from(modelPresets).where(eq(modelPresets.modelId, model.id)).orderBy(modelPresets.sortOrder)).map(async (preset) => ({
        id: preset.publicId, name: preset.name, icon: preset.icon, defaultChoiceId: preset.defaultChoiceId,
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
    return { data: await db.select().from(labs) }
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
    const body = request.body as { name?: string; logo?: string }
    const [updated] = await db.update(labs).set({ name: body.name?.trim(), logo: body.logo?.trim(), updatedAt: new Date() }).where(eq(labs.id, id)).returning()
    if (!updated) throw notFound('Lab')
    return updated
  })

  app.delete('/api/admin/labs/:id', async (request, reply) => {
    requireAdmin(request)
    const { id } = request.params as { id: string }
    const deleted = await db.delete(labs).where(eq(labs.id, id)).returning({ id: labs.id })
    if (!deleted.length) throw notFound('Lab')
    reply.code(204).send()
  })

  app.get('/api/admin/models', async (request) => {
    requireAdmin(request)
    const rows = await db.select({ model: models, pricing: modelPricingVersions }).from(models)
      .leftJoin(modelPricingVersions, and(eq(models.id, modelPricingVersions.modelId), isNull(modelPricingVersions.effectiveTo)))
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
    const raw = z.object({ presets: presetSchema.default([]) }).passthrough().parse(request.body)
    const input = createModelSchema.parse(raw)
    await validatePresets(input.id, raw.presets, input.allowedParameters)
    const pricingId = newId()
    await db.transaction(async (tx) => {
      await tx.insert(models).values({
        id: input.id,
        providerConnectionId: input.providerConnectionId,
        labId: input.labId,
        upstreamModelId: input.upstreamModelId,
        name: input.name,
        description: input.description,
        enabled: input.enabled,
        contextWindow: input.contextWindow,
        maxOutputTokens: input.maxOutputTokens,
        executionMode: input.executionMode,
        tags: input.tags,
        allowedParameters: input.allowedParameters,
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
    const [current] = await db.select().from(models).where(eq(models.id, id)).limit(1)
    if (!current) throw notFound('Model')
    const parsedPresets = body.presets === undefined ? undefined : presetSchema.parse(body.presets)
    const effectiveAllowed = Array.isArray(body.allowedParameters) ? body.allowedParameters.filter((value): value is string => typeof value === 'string') : current.allowedParameters as string[]
    if (parsedPresets) await validatePresets(id, parsedPresets, effectiveAllowed)
    const [updated] = await db.update(models).set({
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      upstreamModelId: typeof body.upstreamModelId === 'string' ? body.upstreamModelId : undefined,
      providerConnectionId: typeof body.providerConnectionId === 'string' ? body.providerConnectionId : undefined,
      labId: typeof body.labId === 'string' || body.labId === null ? body.labId : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      contextWindow: typeof body.contextWindow === 'number' ? body.contextWindow : undefined,
      maxOutputTokens: typeof body.maxOutputTokens === 'number' ? body.maxOutputTokens : undefined,
      executionMode: body.executionMode === 'background' ? 'background' : body.executionMode === 'stream' ? 'stream' : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      allowedParameters: Array.isArray(body.allowedParameters) ? body.allowedParameters : undefined,
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
    const deleted = await db.delete(models).where(eq(models.id, id)).returning({ id: models.id })
    if (!deleted.length) throw notFound('Model')
    reply.code(204).send()
  })
}
