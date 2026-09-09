import { and, eq, lte, sql } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { db } from '../database/client.js'
import { providerConnections, speechModels, speechResourceCleanup } from '../database/schema.js'
import { getConfig } from '../config.js'
import { decryptSecret } from '../lib/crypto.js'
import { assertSafeProviderUrl } from '../lib/url-security.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { deleteMistralVoice, listMistralVoices, type SpeechConnection } from './mistral.js'
import type { SpeechVoiceAssets } from './asset-types.js'

export type SpeechTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
// Serialize publication and cleanup so a resource cannot be deleted while referenced.
export const lockSpeechResources = (tx: SpeechTransaction) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('pulpo-speech-resources'))`)
export async function speechConnection(providerId: string, signal = AbortSignal.timeout(120_000)): Promise<SpeechConnection> {
  const [provider] = await db.select().from(providerConnections).where(eq(providerConnections.id, providerId)).limit(1)
  if (!provider?.encryptedApiKey) throw new AppError(400, 'speech_provider_invalid', 'Choose a provider with an API key')
  await assertSafeProviderUrl(provider.baseUrl)
  return { baseUrl: provider.baseUrl, organizationId: provider.organizationId, projectId: provider.projectId, apiKey: decryptSecret(provider.encryptedApiKey, getConfig().ENCRYPTION_KEY), signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(provider.requestTimeoutMs, 120_000))]) }
}
export async function queueSpeechCleanup(tx: SpeechTransaction, providerId: string, assets: SpeechVoiceAssets[]) {
  for (const asset of assets) {
    if (asset.clone) await tx.insert(speechResourceCleanup).values({ id: newId(), providerConnectionId: providerId, upstreamVoiceId: asset.clone.upstreamVoiceId, objectKeys: [asset.clone.objectKey] })
    if (asset.watermark) await tx.insert(speechResourceCleanup).values({ id: newId(), objectKeys: [asset.watermark.objectKey] })
  }
}
export async function retrySpeechCleanup(request: FastifyRequest, id?: string) {
  const jobs = await db.select({ id: speechResourceCleanup.id }).from(speechResourceCleanup).where(and(lte(speechResourceCleanup.readyAt, new Date()), id ? eq(speechResourceCleanup.id, id) : undefined)).limit(20)
  const deadline = Date.now() + 30_000
  for (const job of jobs) {
    if (Date.now() >= deadline) break
    try {
      await db.transaction(async tx => {
        await lockSpeechResources(tx)
        const [current] = await tx.select().from(speechResourceCleanup).where(eq(speechResourceCleanup.id, job.id)).for('update')
        if (!current || current.readyAt > new Date()) return
        const models = await tx.select().from(speechModels)
        let upstreamId = current.upstreamVoiceId
        const connection = current.providerConnectionId ? await speechConnection(current.providerConnectionId, AbortSignal.timeout(Math.max(1, deadline - Date.now()))) : undefined
        if (!upstreamId && current.slug && connection) upstreamId = (await listMistralVoices(connection)).find(voice => voice.slug === current.slug)?.id ?? null
        const referenced = upstreamId && models.some(model => model.providerConnectionId === current.providerConnectionId && (
          model.config.voices.some(voice => voice.kind !== 'cloned' && voice.id === upstreamId) ||
          (model.voiceAssets ?? []).some(asset => asset.clone?.upstreamVoiceId === upstreamId)))
        if (referenced) throw new AppError(409, 'speech_cleanup_referenced', 'Provider voice is still used by another speech model')
        if (upstreamId && connection) await deleteMistralVoice(connection, upstreamId)
        for (const key of current.objectKeys) {
          if (models.some(model => (model.voiceAssets ?? []).some(asset => asset.clone?.objectKey === key || asset.watermark?.objectKey === key) || model.voicePreviews.some(clip => clip.objectKey === key))) throw new AppError(409, 'speech_cleanup_referenced', 'Audio asset is still in use')
          await getBlobStore().delete(key)
        }
        await tx.delete(speechResourceCleanup).where(eq(speechResourceCleanup.id, current.id))
      })
    } catch (error) {
      await db.update(speechResourceCleanup).set({ error: error instanceof AppError ? error.message : 'Resource cleanup failed. Check the provider connection and storage, then retry.', updatedAt: new Date() }).where(eq(speechResourceCleanup.id, job.id))
      request.log.warn({ cleanupId: job.id }, 'Speech resource cleanup needs attention')
    }
  }
}
