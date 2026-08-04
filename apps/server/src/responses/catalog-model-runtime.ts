import OpenAI from 'openai'
import { and, eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { models, providerConnections } from '../database/schema.js'
import { getConfig } from '../config.js'
import { decryptSecret } from '../lib/crypto.js'

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

export function createCatalogModelClient(runtime: CatalogModelRuntime): OpenAI {
  return new OpenAI({
    apiKey: decryptSecret(runtime.provider.encryptedApiKey, getConfig().ENCRYPTION_KEY),
    baseURL: runtime.provider.baseUrl,
    organization: runtime.provider.organizationId ?? undefined,
    project: runtime.provider.projectId ?? undefined,
    timeout: runtime.provider.requestTimeoutMs,
    maxRetries: runtime.model.maxRetries,
  })
}
