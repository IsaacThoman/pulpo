import { createHash } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, models, ocrAttempts, ocrCacheEntries, requestLogs } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { parseOcrSettings } from '../settings/application-settings.js'
import { publishAdminUsage } from '../admin/usage-events.js'
import { trackBilledInternalModelCall } from './model-calls.js'
import { detailedPayloadCaptureIsActive } from '../logging/detailed-payload-retention.js'

export const OCR_MAX_OUTPUT_TOKENS = 4_096
import { createCatalogModelClient, resolveAvailableCatalogModel, resolveLegacyOcrCatalogModel, type CatalogModelRuntime } from './catalog-model-runtime.js'
import { modelImageRendition } from './model-image.js'

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

export async function createModelImageInterceptor(
  requestLogId: string,
  options: { allowCache?: boolean; responseId?: string; onBilledCost?: (costMicros: number) => void } = {},
): Promise<ModelImageInterceptor> {
  const [ocrRow, requestLog] = await Promise.all([
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'ocr')).limit(1).then((rows) => rows[0]),
    db.select({ ocrStatus: requestLogs.ocrStatus }).from(requestLogs).where(eq(requestLogs.id, requestLogId)).limit(1).then((rows) => rows[0]),
  ])
  const settings = parseOcrSettings(ocrRow?.value)
  let status = requestLog?.ocrStatus ?? 'not_requested'
  let runtimePromise: Promise<CatalogModelRuntime> | undefined
  let catalogClient: ReturnType<typeof createCatalogModelClient> | undefined

  const ocrRuntime = async (): Promise<CatalogModelRuntime> => {
    if (runtimePromise) return runtimePromise
    runtimePromise = (async () => {
      const runtime = settings.modelId
        ? await resolveAvailableCatalogModel(settings.modelId)
        : await resolveLegacyOcrCatalogModel(settings.providerConnectionId, settings.model)
      if (!runtime) throw new Error('OCR model is unavailable or not configured')
      return runtime
    })()
    return runtimePromise
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
      const sourceChecksum = image.sourceChecksum ?? createHash('sha256').update(image.data).digest('hex')
      let providerFingerprint = `unconfigured:${settings.modelId ?? settings.model}`
      let cacheChecksum = createHash('sha256').update(providerFingerprint).update(image.data).digest('hex')
      let providerId: string | null = null
      let attemptModelId = settings.modelId ?? settings.model
      try {
        const runtime = await ocrRuntime()
        const client = catalogClient ??= createCatalogModelClient(runtime)
        providerId = runtime.provider.id
        attemptModelId = runtime.model.id
        providerFingerprint = `${runtime.model.id}:${runtime.provider.id}:${runtime.model.upstreamModelId}`
        cacheChecksum = createHash('sha256').update(providerFingerprint).update(image.data).digest('hex')
        const cacheEnabled = settings.cacheEnabled && options.allowCache !== false
        const [cached] = cacheEnabled
          ? await db.select().from(ocrCacheEntries).where(and(eq(ocrCacheEntries.checksum, cacheChecksum), gt(ocrCacheEntries.expiresAt, new Date()))).limit(1)
          : []
        let text = cached?.text
        let rawResponse: unknown
        if (!text) {
          const encoded = dataUrl(image)
          const ocrInput = [{ role: 'user' as const, content: [{ type: 'input_image' as const, image_url: encoded, detail: 'auto' as const }] }]
          const maxOutputTokens = Math.min(OCR_MAX_OUTPUT_TOKENS, runtime.model.maxOutputTokens)
          if (!options.responseId) throw new Error('OCR billing requires a response id')
          const billed = await trackBilledInternalModelCall({
            responseId: options.responseId,
            requestLogId,
            modelId: runtime.model.id,
            upstreamModelId: runtime.model.upstreamModelId,
            purpose: 'ocr',
            requestInput: ocrInput,
            maxOutputTokens,
            invoke: () => client.responses.create({
              model: runtime.model.upstreamModelId,
              instructions: settings.systemPrompt,
              input: ocrInput,
              store: false,
              max_output_tokens: maxOutputTokens,
            }),
          })
          if ('skipped' in billed) return null
          rawResponse = billed.result
          options.onBilledCost?.(billed.costMicros)
          text = (rawResponse as { output_text?: string }).output_text?.trim()
          if (!text) throw new Error('OCR returned no text')
          if (cacheEnabled) {
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
        await db.transaction(async (tx) => {
          const [payloadPolicy] = await tx.select({
            captureDetailedPayloads: requestLogs.captureDetailedPayloads,
            payloadExpiresAt: requestLogs.payloadExpiresAt,
          }).from(requestLogs).where(eq(requestLogs.id, requestLogId)).for('update').limit(1)
          const captureDetailedPayloads = payloadPolicy && detailedPayloadCaptureIsActive(payloadPolicy)
          await tx.insert(ocrAttempts).values({
            id: attemptId,
            requestLogId,
            attachmentId: image.attachmentId ?? null,
            sourceChecksum,
            providerId,
            modelId: runtime.model.id,
            status: 'completed',
            cached: Boolean(cached),
            requestPayload: captureDetailedPayloads ? { model: runtime.model.upstreamModelId, input: dataUrl(image) } : null,
            responsePayload: captureDetailedPayloads ? rawResponse : null,
            durationMs: Date.now() - started,
          })
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
          modelId: attemptModelId,
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
      const rendition = await modelImageRendition(parsed.data, parsed.mimeType)
      const text = await interceptor.intercept(model, { ...rendition, label: 'embedded image' })
      content.push(text === null
        ? { ...image, image_url: dataUrl(rendition) }
        : { type: 'input_text', text })
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
      const image = part as {
        type?: unknown
        data?: unknown
        mimeType?: unknown
        label?: unknown
        attachmentId?: unknown
        sourceChecksum?: unknown
      }
      if (image.type !== 'image' || typeof image.data !== 'string' || typeof image.mimeType !== 'string') {
        content.push(part)
        continue
      }
      const sourceChecksum = typeof image.sourceChecksum === 'string' ? image.sourceChecksum : undefined
      const rendition = await modelImageRendition(Buffer.from(image.data, 'base64'), image.mimeType, sourceChecksum)
      const text = await interceptor.intercept(model, {
        ...rendition,
        label: typeof image.label === 'string' ? image.label : label,
        attachmentId: typeof image.attachmentId === 'string' ? image.attachmentId : undefined,
        sourceChecksum,
      })
      content.push(text === null
        ? { type: 'image', data: rendition.data.toString('base64'), mimeType: rendition.mimeType }
        : { type: 'text', text })
    }
    messages.push({ ...record, content })
  }
  return { ...typed, messages } as T
}
