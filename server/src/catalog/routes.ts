import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { createModelSchema, createProviderSchema } from '@pulpo/contracts'
import { db } from '../database/client.js'
import {
  auditEvents,
  modelPricingVersions,
  models,
  providerConnections,
} from '../database/schema.js'
import { getConfig } from '../config.js'
import { encryptSecret } from '../lib/crypto.js'
import { newId } from '../lib/ids.js'
import { requireAdmin, requireUser } from '../auth/service.js'

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/models', async (request) => {
    requireUser(request)
    const rows = await db
      .select({ model: models, pricing: modelPricingVersions })
      .from(models)
      .leftJoin(modelPricingVersions, and(
        eq(models.id, modelPricingVersions.modelId),
        isNull(modelPricingVersions.effectiveTo),
      ))
      .where(eq(models.enabled, true))
    return { data: rows.map(({ model, pricing }) => ({
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
      tags: model.tags,
    })) }
  })

  app.get('/api/admin/providers', async (request) => {
    requireAdmin(request)
    const rows = await db.select().from(providerConnections)
    return { data: rows.map(({ encryptedApiKey: _, ...row }) => ({ ...row, hasApiKey: true })) }
  })

  app.post('/api/admin/providers', async (request, reply) => {
    const admin = requireAdmin(request)
    const input = createProviderSchema.parse(request.body)
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

  app.get('/api/admin/models', async (request) => {
    requireAdmin(request)
    return { data: await db.select().from(models) }
  })

  app.post('/api/admin/models', async (request, reply) => {
    const admin = requireAdmin(request)
    const input = createModelSchema.parse(request.body)
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
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'model.create', targetType: 'model', targetId: input.id,
      })
    })
    reply.code(201)
    return { id: input.id, pricingVersionId: pricingId }
  })
}
