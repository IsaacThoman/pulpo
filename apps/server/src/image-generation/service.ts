import { basename, extname } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { imageGenerationPreferencesSchema, imageModelSchema, IMAGE_GENERATION_MAX_BYTES, IMAGE_PROVIDER_CAPABILITIES, type ImageGenerationInput, type ImageModel } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { attachments, imageGenerationRequests, imageModels, providerConnections, toolExecutions, userPreferences } from '../database/schema.js'
import { getBlobStore } from '../storage/index.js'
import { decryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { assertSafeProviderUrl } from '../lib/url-security.js'
import { storeGeneratedAttachment, generatedAttachmentMetadata, type GeneratedAttachment } from '../attachments/generated.js'
import { getStorageUsage } from '../attachments/storage-quota.js'
import { createAttachmentThumbnail } from '../attachments/thumbnail.js'
import { restoredAttachmentWorkspacePath, attachmentWorkspacePath } from '../agent/policy.js'
import type { WorkspaceManager } from '../agent/controller.js'
import { generateImage, validateImageBytes, validateImageRequest, type ImageReference, type ImageResultMetadata } from './provider.js'

const unavailable = () => new AppError(400, 'image_generation_unavailable', 'Enable image generation and choose an available model in Settings')
export async function selectedImageModel(userId: string) {
  const [preferences] = await db.select({ values: userPreferences.values }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1)
  const values = preferences?.values as Record<string, unknown> | undefined
  const preference = imageGenerationPreferencesSchema.catch({ enabled: false, modelId: null }).parse(values?.imageGeneration)
  if (!preference.enabled || !preference.modelId) return null
  const [row] = await db.select({ config: imageModels.config, provider: providerConnections }).from(imageModels)
    .innerJoin(providerConnections, eq(imageModels.providerConnectionId, providerConnections.id)).where(eq(imageModels.id, preference.modelId)).limit(1)
  return row?.config.enabled && row.provider.enabled && row.provider.encryptedApiKey ? { model: imageModelSchema.parse(row.config), provider: row.provider } : null
}

async function attachmentReference(attachment: typeof attachments.$inferSelect, model: ImageModel): Promise<ImageReference> {
  if (attachment.sizeBytes > IMAGE_GENERATION_MAX_BYTES) throw new AppError(400, 'image_input_limit', 'Reference images must be no larger than 20 MiB')
  const data = await getBlobStore().get(attachment.objectKey)
  const mimeType = await validateImageBytes(data)
  const [prior] = await db.select().from(imageGenerationRequests).where(and(eq(imageGenerationRequests.attachmentId, attachment.id), eq(imageGenerationRequests.status, 'completed'))).limit(1)
  const compatible = IMAGE_PROVIDER_CAPABILITIES[model.adapter].supportsImageItemReplay && prior?.model.adapter === model.adapter
    && prior.model.providerConnectionId === model.providerConnectionId && prior.model.upstreamModelId === model.upstreamModelId
  return { data, mimeType, ...(compatible && prior.result?.imageItem ? { priorImageItem: prior.result.imageItem } : {}) }
}

export async function resolveImageReferences(input: ImageGenerationInput, userId: string, chatId: string, model: ImageModel, manager: WorkspaceManager, signal?: AbortSignal): Promise<ImageReference[]> {
  const references: ImageReference[] = []
  for (const reference of input.referenceImages ?? []) {
    signal?.throwIfAborted()
    // Existing attachments can be read without provisioning a workspace.
    const rows = await db.select().from(attachments).where(and(eq(attachments.userId, userId), eq(attachments.chatId, chatId), eq(attachments.status, 'ready'), ...('attachmentId' in reference ? [eq(attachments.id, reference.attachmentId)] : [])))
    const attachment = 'attachmentId' in reference ? rows[0] : rows.find(row => restoredAttachmentWorkspacePath(row) === reference.path || attachmentWorkspacePath(row.originalName, row.id) === reference.path)
    if (attachment) references.push(await attachmentReference(attachment, model))
    else if ('attachmentId' in reference) throw new AppError(404, 'image_reference_missing', 'Reference image is not available in this chat')
    else {
      if (!reference.path.startsWith('/workspace/')) throw new AppError(400, 'image_reference_path', 'Reference image files must be inside /workspace')
      const file = await manager.exportFile(reference.path, signal).catch(() => {
        signal?.throwIfAborted()
        throw new AppError(400, 'image_reference_unreadable', 'Reference image could not be read from the workspace; check the path or use a chat attachment ID')
      })
      const mimeType = await validateImageBytes(file.data)
      references.push({ data: file.data, mimeType })
    }
  }
  return references
}

export interface ImageExecutionResult {
  attachment: GeneratedAttachment
  path: string
  previewData: string
  metadata: ImageResultMetadata
  billedCostMicros: number
  model: ImageModel
}

async function recordSavedImage(claim: typeof imageGenerationRequests.$inferSelect, attachmentId: string, runId: string) {
  const billedCostMicros = claim.model.billUsers ? claim.model.imagePriceMicros : 0
  await db.transaction(async tx => {
    await tx.update(imageGenerationRequests).set({ status: 'completed', attachmentId, billedCostMicros, updatedAt: new Date() })
      .where(and(eq(imageGenerationRequests.responseId, claim.responseId), eq(imageGenerationRequests.operationId, claim.operationId)))
    await tx.update(toolExecutions).set({ status: 'completed', provider: claim.model.adapter, billedCostMicros,
      providerAttempts: [{ provider: claim.model.adapter, modelId: claim.model.id, upstreamModelId: claim.model.upstreamModelId, providerId: claim.model.providerConnectionId, outcome: 'success', usage: claim.result?.usage, imagePriceMicros: claim.model.imagePriceMicros, requestId: claim.result?.upstreamResponseId }],
      completedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(toolExecutions.agentRunId, runId), eq(toolExecutions.operationId, claim.operationId)))
  })
  return billedCostMicros
}

// Reconcile the crash window between saving a blob and recording its charge, even
// when the resumed agent does not replay the tool or the user has since opted out.
export async function recoverSavedImageGenerations(responseId: string, runId: string) {
  const saved = await db.select({ claim: imageGenerationRequests, attachmentId: attachments.id }).from(imageGenerationRequests)
    .innerJoin(attachments, and(eq(attachments.sourceResponseId, imageGenerationRequests.responseId), eq(attachments.sourceToolCallId, imageGenerationRequests.operationId)))
    .where(and(eq(imageGenerationRequests.responseId, responseId), inArray(imageGenerationRequests.status, ['claimed', 'failed']), eq(attachments.status, 'ready')))
  for (const { claim, attachmentId } of saved) {
    if (claim.result) await recordSavedImage(claim, attachmentId, runId)
  }
}

export async function executeImageGeneration(input: {
  userId: string; chatId: string; responseId: string; runId: string; operationId: string; args: ImageGenerationInput
  manager: WorkspaceManager; signal?: AbortSignal; reserveCost: (micros: number) => Promise<void>
}): Promise<ImageExecutionResult> {
  const selection = await selectedImageModel(input.userId)
  if (!selection) throw unavailable()
  const { model, provider } = selection
  const condition = and(eq(imageGenerationRequests.responseId, input.responseId), eq(imageGenerationRequests.operationId, input.operationId))
  const finish = async (claim: typeof imageGenerationRequests.$inferSelect, attachment: typeof attachments.$inferSelect): Promise<ImageExecutionResult> => {
    if (!claim.result) throw new AppError(409, 'image_request_uncertain', 'This image request was interrupted; submit a new request to try again')
    const billedCostMicros = await recordSavedImage(claim, attachment.id, input.runId)
    const data = await getBlobStore().get(attachment.objectKey)
    const path = restoredAttachmentWorkspacePath(attachment)
    let text = claim.result.text
    try { await input.manager.stageGeneratedAttachment(attachment.id, input.signal) }
    catch { text += '\nWorkspace copy is unavailable; use the attachment ID for subsequent image edits.' }
    return {
      attachment: { id: attachment.id, name: attachment.originalName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes },
      path, previewData: (await createAttachmentThumbnail(data)).toString('base64'), metadata: { ...claim.result, text }, billedCostMicros, model: claim.model,
    }
  }
  const [existing] = await db.select().from(imageGenerationRequests).where(condition).limit(1)
  if (existing) {
    const [attachment] = await db.select().from(attachments).where(and(eq(attachments.userId, input.userId), eq(attachments.sourceResponseId, input.responseId), eq(attachments.sourceToolCallId, input.operationId), eq(attachments.status, 'ready'))).limit(1)
    if (attachment && existing.result) return finish(existing, attachment)
    throw new AppError(409, 'image_request_uncertain', 'This image request was already submitted but has no saved result; submit a new request to try again')
  }
  const references = await resolveImageReferences(input.args, input.userId, input.chatId, model, input.manager, input.signal)
  validateImageRequest(model, input.args.prompt, references)
  for (const reference of references) await validateImageBytes(reference.data, model.adapter === 'azure-mai' ? ['image/png', 'image/jpeg'] : undefined)
  if ((await getStorageUsage(input.userId)).remainingBytes <= 0) throw new AppError(413, 'storage_quota_exceeded', 'Free some attachment storage before generating an image')
  await assertSafeProviderUrl(provider.baseUrl)
  input.signal?.throwIfAborted()
  const claims = await db.insert(imageGenerationRequests).values({ responseId: input.responseId, operationId: input.operationId, model }).onConflictDoNothing().returning()
  if (!claims.length) throw new AppError(409, 'image_request_duplicate', 'This image request is already running')
  try {
    await input.reserveCost(model.billUsers ? model.imagePriceMicros : 0)
    // Settings or provider availability may have changed while inputs were loading.
    const current = await selectedImageModel(input.userId)
    if (!current || current.model.id !== model.id || JSON.stringify(current.model) !== JSON.stringify(model) || current.provider.updatedAt.getTime() !== provider.updatedAt.getTime()) throw unavailable()
    const signal = AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(provider.requestTimeoutMs)])
    const result = await generateImage({ model, baseUrl: provider.baseUrl, apiKey: decryptSecret(provider.encryptedApiKey, getConfig().ENCRYPTION_KEY), prompt: input.args.prompt, references, signal })
    const { data, mimeType, ...metadata } = result
    await db.update(imageGenerationRequests).set({ result: metadata, updatedAt: new Date() }).where(condition)
    const extension = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : '.png'
    const requested = basename(input.args.filename ?? 'generated-image')
    const rawName = `${requested.slice(0, requested.length - extname(requested).length).slice(0, 180) || 'generated-image'}${extension}`
    const name = generatedAttachmentMetadata(rawName, undefined, data).name
    const path = `/workspace/generated-${newId()}-${name}`
    const stored = await storeGeneratedAttachment({ responseId: input.responseId, toolCallId: input.operationId, userId: input.userId, chatId: input.chatId, path, requestedName: name, data })
    const [attachment] = await db.select().from(attachments).where(eq(attachments.id, stored.id)).limit(1)
    return await finish({ ...claims[0]!, result: metadata }, attachment!)
  } catch (error) {
    await db.update(imageGenerationRequests).set({ status: 'failed', updatedAt: new Date() }).where(and(condition, inArray(imageGenerationRequests.status, ['claimed', 'failed'])))
    throw error
  }
}
