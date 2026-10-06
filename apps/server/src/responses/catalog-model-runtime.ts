import { diagnosticFetch } from '../logging/diagnostic-fetch.js'
import { and, eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { models, providerConnections } from '../database/schema.js'
import { createUpstreamTextClient, type UpstreamTextClient } from '../upstream/client.js'

export type CatalogModelRuntime = {
  model: typeof models.$inferSelect
  provider: typeof providerConnections.$inferSelect
}

export async function resolveAvailableCatalogModel(modelId: string): Promise<CatalogModelRuntime | null> {
  const [runtime] = await db.select({ model: models, provider: providerConnections })
    .from(models)
    .innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id))
    .where(and(eq(models.id, modelId), eq(models.enabled, true), eq(models.visible, true)))
    .limit(1)
  return runtime ?? null
}

export async function resolveLegacyOcrCatalogModel(
  providerConnectionId: string | null,
  upstreamModelId: string,
): Promise<CatalogModelRuntime | null> {
  if (!providerConnectionId) return null
  const [runtime] = await db.select({ model: models, provider: providerConnections })
    .from(models)
    .innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id))
    .where(and(
      eq(models.providerConnectionId, providerConnectionId),
      eq(models.upstreamModelId, upstreamModelId),
      eq(models.enabled, true),
      eq(models.visible, true),
    ))
    .limit(1)
  return runtime ?? null
}

export function createCatalogModelClient(runtime: CatalogModelRuntime): UpstreamTextClient {
  return createUpstreamTextClient(runtime.provider, {
    fetch: diagnosticFetch({ purpose: 'internal', providerId: runtime.provider.id, modelId: runtime.model.id, upstreamModelId: runtime.model.upstreamModelId }),
    maxRetries: runtime.model.maxRetries,
  })
}
