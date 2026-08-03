import OpenAI from 'openai'
import { createHash } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, models, ocrAttempts, ocrCacheEntries, providerConnections, requestLogs } from '../database/schema.js'
import { getConfig } from '../config.js'
import { decryptSecret } from '../lib/crypto.js'
import { newId } from '../lib/ids.js'
import { parseLoggingSettings, parseOcrSettings } from '../settings/application-settings.js'
import { publishAdminUsage } from '../admin/usage-events.js'
import { trackInternalModelCall } from './model-calls.js'

export type OcrModel = Pick<typeof models.$inferSelect, 'id' | 'interceptImagesWithOcr'>

export interface ModelBoundImage {
  data: Uint8Array
  mimeType: string
  label: string
  attachmentId?: string | null
  sourceChecksum?: string | null
}

export interface ModelImageInterceptor {
  intercept(model: OcrModel, image: ModelBoundImage): Promise<string | null>
}

function dataUrl(image: Pick<ModelBoundImage, 'data' | 'mimeType'>): string {
  return `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}`
}

export function aggregateOcrStatus(current: string, next: 'completed' | 'failed'): 'completed' | 'failed' {
  return current === 'failed' || next === 'failed' ? 'failed' : 'completed'
}

export async function createModelImageInterceptor(requestLogId: string): Promise<ModelImageInterceptor> {
  const [ocrRow, loggingRow, requestLog] = await Promise.all([
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'ocr')).limit(1).then((rows) => rows[0]),
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'logging')).limit(1).then((rows) => rows[0]),
    db.select({ ocrStatus: requestLogs.ocrStatus }).from(requestLogs).where(eq(requestLogs.id, requestLogId)).limit(1).then((rows) => rows[0]),
  ])
  const settings = parseOcrSettings(ocrRow?.value)
  const logging = parseLoggingSettings(loggingRow?.value)
  let status = requestLog?.ocrStatus ?? 'not_requested'
  let clientPromise: Promise<{ client: OpenAI; providerId: string | null }> | undefined

  const ocrClient = async (): Promise<{ client: OpenAI; providerId: string | null }> => {
    if (clientPromise) return clientPromise
    clientPromise = (async () => {
      if (settings.providerMode === 'existing' && settings.providerConnectionId) {
        const [provider] = await db.select().from(providerConnections).where(eq(providerConnections.id, settings.providerConnectionId)).limit(1)
        if (!provider) throw new Error('OCR provider is unavailable')
        return {
          client: new OpenAI({ apiKey: decryptSecret(provider.encryptedApiKey, getConfig().ENCRYPTION_KEY), baseURL: provider.baseUrl, timeout: provider.requestTimeoutMs }),
          providerId: provider.id,
        }
      }
      if (settings.customBaseUrl && settings.encryptedCustomApiKey) {
        return {
          client: new OpenAI({ apiKey: decryptSecret(settings.encryptedCustomApiKey, getConfig().ENCRYPTION_KEY), baseURL: settings.customBaseUrl }),
          providerId: null,
        }
      }
      throw new Error('OCR provider is not configured')
    })()
    return clientPromise
  }

  const updateStatus = async (next: 'completed' | 'failed') => {
    status = aggregateOcrStatus(status, next)
    await db.update(requestLogs).set({ ocrStatus: status, updatedAt: new Date() }).where(eq(requestLogs.id, requestLogId))
  }

  return {
    async intercept(model, image) {
      if (!settings.enabled || !model.interceptImagesWithOcr) return null
      const attemptId = newId()
      const started = Date.now()
      const providerFingerprint = `${settings.providerMode}:${settings.providerConnectionId ?? settings.customBaseUrl}:${settings.model}`
      const sourceChecksum = image.sourceChecksum ?? createHash('sha256').update(image.data).digest('hex')
      const cacheChecksum = createHash('sha256').update(providerFingerprint).update(image.data).digest('hex')
      let providerId = settings.providerMode === 'existing' ? settings.providerConnectionId : null
      try {
        const [cached] = settings.cacheEnabled
          ? await db.select().from(ocrCacheEntries).where(and(eq(ocrCacheEntries.checksum, cacheChecksum), gt(ocrCacheEntries.expiresAt, new Date()))).limit(1)
          : []
        let text = cached?.text
        let rawResponse: unknown
        if (!text) {
          const resolved = await ocrClient()
          providerId = resolved.providerId
          const encoded = dataUrl(image)
          rawResponse = await trackInternalModelCall({
            requestLogId,
            modelId: model.id,
            upstreamModelId: settings.model,
            purpose: 'ocr',
            invoke: () => resolved.client.responses.create({
              model: settings.model,
              instructions: settings.systemPrompt,
              input: [{ role: 'user', content: [{ type: 'input_image', image_url: encoded, detail: 'auto' }] }],
              store: false,
            }),
          })
          text = (rawResponse as { output_text?: string }).output_text?.trim()
          if (!text) throw new Error('OCR returned no text')
          if (settings.cacheEnabled) {
            await db.insert(ocrCacheEntries).values({
              checksum: cacheChecksum,
              providerFingerprint,
              text,
              expiresAt: new Date(Date.now() + settings.cacheTtlSeconds * 1000),
            }).onConflictDoUpdate({
              target: ocrCacheEntries.checksum,
              set: { text, expiresAt: new Date(Date.now() + settings.cacheTtlSeconds * 1000) },
            })
          }
        }
        await db.insert(ocrAttempts).values({
          id: attemptId,
          requestLogId,
          attachmentId: image.attachmentId ?? null,
          sourceChecksum,
          providerId,
          modelId: settings.model,
          status: 'completed',
          cached: Boolean(cached),
          requestPayload: logging.logDetailedPayloads ? { model: settings.model, input: dataUrl(image) } : null,
          responsePayload: logging.logDetailedPayloads ? rawResponse : null,
          durationMs: Date.now() - started,
        })
        await updateStatus('completed')
        await publishAdminUsage(requestLogId, true)
        return `[OCR text from ${image.label}]\n${text}`
      } catch (error) {
        const message = error instanceof Error ? error.message : 'OCR failed'
        await db.insert(ocrAttempts).values({
          id: attemptId,
          requestLogId,
          attachmentId: image.attachmentId ?? null,
          sourceChecksum,
          providerId,
          modelId: settings.model,
          status: 'failed',
          errorMessage: message,
          durationMs: Date.now() - started,
        })
        await updateStatus('failed')
        await publishAdminUsage(requestLogId, true)
        return `[OCR error for ${image.label}: ${message}]`
      }
    },
  }
}

function parseDataUrl(value: string): { data: Uint8Array; mimeType: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(value)
  if (!match) return null
  return { mimeType: match[1]!, data: Buffer.from(match[2]!.replace(/\s/g, ''), 'base64') }
}

export async function interceptOpenAIInputImages(
  input: unknown[],
  model: OcrModel,
  interceptor: ModelImageInterceptor,
): Promise<unknown[]> {
  const transformed: unknown[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      transformed.push(item)
      continue
    }
    const typed = item as Record<string, unknown>
    if (!Array.isArray(typed.content)) {
      transformed.push(item)
      continue
    }
    const content: unknown[] = []
    for (const part of typed.content) {
      if (!part || typeof part !== 'object') {
        content.push(part)
        continue
      }
      const image = part as { type?: unknown; image_url?: unknown }
      if (image.type !== 'input_image' || typeof image.image_url !== 'string') {
        content.push(part)
        continue
      }
      const parsed = parseDataUrl(image.image_url)
      if (!parsed) {
        content.push(part)
        continue
      }
      const text = await interceptor.intercept(model, { ...parsed, label: 'embedded image' })
      content.push(text === null ? part : { type: 'input_text', text })
    }
    transformed.push({ ...typed, content })
  }
  return transformed
}

function agentImageLabel(message: Record<string, unknown>): string {
  if (message.toolName !== 'view_image' || !Array.isArray(message.content)) return 'agent image'
  const viewed = message.content.find((part) => part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') as { text?: unknown } | undefined
  if (typeof viewed?.text !== 'string') return 'view_image result'
  return /^Viewed (.+) \(image\//.exec(viewed.text)?.[1] ?? 'view_image result'
}

export async function interceptAgentContextImages<T>(
  context: T,
  model: OcrModel,
  interceptor: ModelImageInterceptor,
): Promise<T> {
  if (!context || typeof context !== 'object') return context
  const typed = context as Record<string, unknown>
  if (!Array.isArray(typed.messages)) return context
  const messages: unknown[] = []
  for (const message of typed.messages) {
    if (!message || typeof message !== 'object') {
      messages.push(message)
      continue
    }
    const record = message as Record<string, unknown>
    if (!Array.isArray(record.content)) {
      messages.push(message)
      continue
    }
    const label = agentImageLabel(record)
    const content: unknown[] = []
    for (const part of record.content) {
      if (!part || typeof part !== 'object') {
        content.push(part)
        continue
      }
      const image = part as { type?: unknown; data?: unknown; mimeType?: unknown }
      if (image.type !== 'image' || typeof image.data !== 'string' || typeof image.mimeType !== 'string') {
        content.push(part)
        continue
      }
      const text = await interceptor.intercept(model, { data: Buffer.from(image.data, 'base64'), mimeType: image.mimeType, label })
      content.push(text === null ? part : { type: 'text', text })
    }
    messages.push({ ...record, content })
  }
  return { ...typed, messages } as T
}
