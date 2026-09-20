import sharp from 'sharp'
import { reportDiagnosticFailure } from '../logging/provider-diagnostics.js'
import { diagnosticFetch } from '../logging/diagnostic-fetch.js'
import { basename, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { imageGenerationPreferencesSchema, imageModelSchema, IMAGE_GENERATION_MAX_BYTES, IMAGE_PROVIDER_CAPABILITIES, type ImageGenerationInput, type ImageModel } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { attachments, responses, imageGenerationRequests, imageModels, providerConnections, toolExecutions, userPreferences } from '../database/schema.js'
import { getBlobStore } from '../storage/index.js'
import { decryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { assertSafeProviderUrl } from '../lib/url-security.js'
import { generatedAttachmentMetadata } from '../attachments/generated.js'
import { restoredAttachmentWorkspacePath, attachmentWorkspacePath } from '../agent/policy.js'
import { WorkspaceManager } from '../agent/controller.js'
import { imageCost, imageReservation } from './pricing.js'
import { generateImage, validateImageBytes, validateImageRequest, type ImageReference, type ImageResultMetadata } from './provider.js'
import { readImageDefaults } from './defaults.js'

const unavailable = () => new AppError(400, 'image_generation_unavailable', 'Enable image generation and choose an available model in Settings')
export async function selectedImageModel(userId: string) {
  const [preferences] = await db.select({ values: userPreferences.values }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1)
  const values = preferences?.values as Record<string, unknown> | undefined
  const preference = imageGenerationPreferencesSchema.catch({ enabled: false, modelId: null }).parse(values?.imageGeneration)
  if (!preference.enabled) return null
  const modelId = preference.modelId ?? (await readImageDefaults()).modelId
  if (!modelId) return null
  const [row] = await db.select({ config: imageModels.config, provider: providerConnections }).from(imageModels)
    .innerJoin(providerConnections, eq(imageModels.providerConnectionId, providerConnections.id)).where(eq(imageModels.id, modelId)).limit(1)
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

export interface GeneratedWorkspaceImage {
  path: string
  name: string
  mimeType: string
  sizeBytes: number
  checksum: string
  leaseId: string
}
export interface SavedImageResult extends ImageResultMetadata {
  workspaceFile?: GeneratedWorkspaceImage
}
export interface ImageExecutionResult {
  file: Pick<GeneratedWorkspaceImage, 'name' | 'mimeType' | 'sizeBytes'>
  path: string
  metadata: ImageResultMetadata
  billedCostMicros: number
  model: ImageModel
}
const checksum = (data: Uint8Array) => createHash('sha256').update(data).digest('base64url')
const matchesSavedFile = (data: Uint8Array, file: GeneratedWorkspaceImage) => data.byteLength === file.sizeBytes && checksum(data) === file.checksum

async function recordSavedImage(claim: typeof imageGenerationRequests.$inferSelect, attachmentId: string | null, runId: string) {
  const billedCostMicros = imageCost(claim.model, claim.result?.usage)
  await db.transaction(async tx => {
    await tx.update(imageGenerationRequests).set({ status: 'completed', attachmentId, billedCostMicros, updatedAt: new Date() })
      .where(and(eq(imageGenerationRequests.responseId, claim.responseId), eq(imageGenerationRequests.operationId, claim.operationId)))
    await tx.update(toolExecutions).set({ status: 'completed', provider: claim.model.adapter, billedCostMicros,
      providerAttempts: [{ provider: claim.model.adapter, modelId: claim.model.id, upstreamModelId: claim.model.upstreamModelId, providerId: claim.model.providerConnectionId, outcome: 'success', usage: claim.result?.usage, imagePriceMicros: claim.model.imagePriceMicros, billingUnit: claim.model.billingUnit ?? 'images', tokenPrices: claim.model.tokenPrices, requestId: claim.result?.upstreamResponseId }],
      completedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(toolExecutions.agentRunId, runId), eq(toolExecutions.operationId, claim.operationId)))
  })
  return billedCostMicros
}

// Reconcile both legacy attachment saves and workspace writes interrupted before
// recording the charge. Only the exact saved bytes in the original lease qualify.
export async function recoverSavedImageGenerations(responseId: string, runId: string, manager?: WorkspaceManager) {
  const saved = await db.select({ claim: imageGenerationRequests, attachmentId: attachments.id }).from(imageGenerationRequests)
    .innerJoin(attachments, and(eq(attachments.sourceResponseId, imageGenerationRequests.responseId), eq(attachments.sourceToolCallId, imageGenerationRequests.operationId)))
    .where(and(eq(imageGenerationRequests.responseId, responseId), inArray(imageGenerationRequests.status, ['claimed', 'failed']), eq(attachments.status, 'ready')))
  for (const { claim, attachmentId } of saved) {
    if (claim.result && !claim.result.workspaceFile) await recordSavedImage(claim, attachmentId, runId)
  }
  const pending = await db.select({ claim: imageGenerationRequests, userId: responses.userId, chatId: responses.chatId }).from(imageGenerationRequests)
    .innerJoin(responses, eq(responses.id, imageGenerationRequests.responseId))
    .where(and(eq(imageGenerationRequests.responseId, responseId), inArray(imageGenerationRequests.status, ['claimed', 'failed'])))
  for (const { claim, userId, chatId } of pending) {
    const file = claim.result?.workspaceFile
    if (!file) continue
    const reader = manager ?? new WorkspaceManager(responseId, chatId, userId)
    const saved = await reader.readGeneratedFile(file.path, file.leaseId).catch(() => null)
    if (saved && matchesSavedFile(saved.data, file)) await recordSavedImage(claim, null, runId)
  }
}

export async function executeImageGeneration(input: {
  userId: string; chatId: string; responseId: string; requestLogId?: string; runId: string; operationId: string; args: ImageGenerationInput
  manager: WorkspaceManager; signal?: AbortSignal; reserveCost: (micros: number) => Promise<void>
}): Promise<ImageExecutionResult> {
  const selection = await selectedImageModel(input.userId)
  if (!selection) throw unavailable()
  const { model, provider } = selection
  const condition = and(eq(imageGenerationRequests.responseId, input.responseId), eq(imageGenerationRequests.operationId, input.operationId))
  const finish = async (claim: typeof imageGenerationRequests.$inferSelect, file: GeneratedWorkspaceImage, attachmentId: string | null = null): Promise<ImageExecutionResult> => {
    if (!claim.result) throw new AppError(409, 'image_request_uncertain', 'This image request was interrupted; submit a new request to try again')
    const billedCostMicros = await recordSavedImage(claim, attachmentId, input.runId)
    const { workspaceFile: _file, ...metadata } = claim.result
    return { file: { name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes }, path: file.path, metadata, billedCostMicros, model: imageModelSchema.parse(claim.model) }
  }
  const [existing] = await db.select().from(imageGenerationRequests).where(condition).limit(1)
  if (existing) {
    const file = existing.result?.workspaceFile
    if (file) {
      const saved = await input.manager.readGeneratedFile(file.path, file.leaseId, input.signal).catch(() => null)
      if (saved && matchesSavedFile(saved.data, file)) return finish(existing, file)
      throw new AppError(409, 'image_workspace_unavailable', 'The generated workspace image is missing or changed; it will not be regenerated automatically')
    }
    // Old operations saved attachments. Reuse them without a second provider call
    // or emitting another user-visible attachment from the generation tool.
    const [attachment] = await db.select().from(attachments).where(and(eq(attachments.userId, input.userId), eq(attachments.sourceResponseId, input.responseId), eq(attachments.sourceToolCallId, input.operationId), eq(attachments.status, 'ready'))).limit(1)
    if (attachment && existing.result) {
      const data = await getBlobStore().get(attachment.objectKey)
      const leaseId = await input.manager.ensureLease(input.signal)
      const file = { path: restoredAttachmentWorkspacePath(attachment), name: attachment.originalName, mimeType: attachment.mimeType, sizeBytes: data.byteLength, checksum: checksum(data), leaseId }
      await input.manager.saveGeneratedFile(file.path, data, file.mimeType, leaseId, input.signal)
      return finish(existing, file, attachment.id)
    }
    throw new AppError(409, 'image_request_uncertain', 'This image request was already submitted but has no saved result; submit a new request to try again')
  }
  const references = await resolveImageReferences(input.args, input.userId, input.chatId, model, input.manager, input.signal)
  validateImageRequest(model, input.args.prompt, references)
  for (const reference of references) await validateImageBytes(reference.data, model.adapter === 'azure-mai' ? ['image/png', 'image/jpeg'] : undefined)
  await assertSafeProviderUrl(provider.baseUrl)
  input.signal?.throwIfAborted()
  const claims = await db.insert(imageGenerationRequests).values({ responseId: input.responseId, operationId: input.operationId, model }).onConflictDoNothing().returning()
  if (!claims.length) throw new AppError(409, 'image_request_duplicate', 'This image request is already running')
  let providerSucceeded = false
  try {
    const reservedMicros = imageReservation(model)
    await input.reserveCost(reservedMicros)
    // Acquire capacity before spending money on an image that needs a workspace.
    const leaseId = await input.manager.ensureLease(input.signal)
    if (input.manager.continuedWithoutAgent) throw new AppError(409, 'image_workspace_unavailable', 'Workspace unavailable; image generation requires an active workspace')
    // Settings or provider availability may have changed while inputs were loading.
    const current = await selectedImageModel(input.userId)
    if (!current || current.model.id !== model.id || JSON.stringify(current.model) !== JSON.stringify(model) || current.provider.updatedAt.getTime() !== provider.updatedAt.getTime()) throw unavailable()
    const signal = AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(provider.requestTimeoutMs)])
    const referenceMetadata = await Promise.all(references.map(async reference => { const m = await sharp(reference.data).metadata().catch(() => ({ width: undefined, height: undefined })); return { mimeType: reference.mimeType, sizeBytes: reference.data.length, width: m.width, height: m.height } }))
    const fetch = diagnosticFetch({ purpose: references.length ? 'image_edit' : 'image_generation', userId: input.userId, requestLogId: input.requestLogId, operationId: input.operationId, providerId: provider.id, modelId: model.id, upstreamModelId: model.upstreamModelId, metadata: { references: referenceMetadata, billingUnit: model.billingUnit } })
    const result = await generateImage({ fetch, model, baseUrl: provider.baseUrl, apiKey: decryptSecret(provider.encryptedApiKey, getConfig().ENCRYPTION_KEY), prompt: input.args.prompt, aspectRatio: input.args.aspectRatio, references, signal })
    providerSucceeded = true
    const { data, mimeType, ...metadata } = result
    await db.update(imageGenerationRequests).set({ result: metadata, updatedAt: new Date() }).where(condition)
    const actualMicros = imageCost(model, metadata.usage)
    if (actualMicros > reservedMicros) await input.reserveCost(actualMicros - reservedMicros)
    input.signal?.throwIfAborted()
    const extension = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : '.png'
    const requested = basename(input.args.filename ?? 'generated-image')
    const rawName = `${requested.slice(0, requested.length - extname(requested).length).slice(0, 180) || 'generated-image'}${extension}`
    const name = generatedAttachmentMetadata(rawName, undefined, data).name
    const path = `/workspace/generated-${newId()}-${name}`
    const file: GeneratedWorkspaceImage = { path, name, mimeType, sizeBytes: data.byteLength, checksum: checksum(data), leaseId }
    const savedResult: SavedImageResult = { ...metadata, workspaceFile: file }
    // Persist identity before PUT so a lost acknowledgement or process restart
    // can verify a completed write without issuing another paid provider request.
    await db.update(imageGenerationRequests).set({ result: savedResult, updatedAt: new Date() }).where(condition)
    try { await input.manager.saveGeneratedFile(path, data, mimeType, leaseId, input.signal) }
    catch (error) {
      const saved = await input.manager.readGeneratedFile(path, leaseId).catch(() => null)
      if (!saved || !matchesSavedFile(saved.data, file)) throw error
    }
    return await finish({ ...claims[0]!, result: savedResult }, file)
  } catch (error) {
    if (!providerSucceeded) await db.update(toolExecutions).set({ provider: model.adapter, providerAttempts: [{ provider: model.adapter, providerId: provider.id, modelId: model.id, upstreamModelId: model.upstreamModelId, outcome: 'failed' }], updatedAt: new Date() }).where(and(eq(toolExecutions.agentRunId, input.runId), eq(toolExecutions.operationId, input.operationId))).catch(() => reportDiagnosticFailure('image_failure_metadata'))
    await db.update(imageGenerationRequests).set({ status: 'failed', updatedAt: new Date() }).where(and(condition, inArray(imageGenerationRequests.status, ['claimed', 'failed'])))
    throw error
  }
}
