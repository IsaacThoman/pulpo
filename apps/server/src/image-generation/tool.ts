/* eslint-disable preserve-caught-error -- Tool errors cross the model boundary; never attach raw provider causes. */
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { imageGenerationInputSchema, IMAGE_PROVIDER_CAPABILITIES, type ImageGenerationInput, type ImageModel } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'
import { ImageGenerationError } from './provider.js'
import type { ImageExecutionResult } from './service.js'

export function createImageGenerationTools(input: {
  model: ImageModel | null
  execute: (id: string, args: ImageGenerationInput, signal?: AbortSignal) => Promise<ImageExecutionResult>
  onStarted: (id: string) => void | Promise<void>
  onAttachment: (id: string, result: ImageExecutionResult) => void | Promise<void>
}): AgentTool[] {
  if (!input.model) return []
  const { maxReferenceImages, inputMimeTypes } = IMAGE_PROVIDER_CAPABILITIES[input.model.adapter]
  return [{
    name: 'generate_image', label: 'Generate image', executionMode: 'sequential',
    description: `Generate or edit an image using the image model selected in the user’s Settings. Supply a detailed text prompt and optional reference images from chat attachments or workspace files. This model accepts up to ${maxReferenceImages} reference image(s) in ${inputMimeTypes.map(type => type.replace('image/', '')).join(', ')} format. For edits, include the previous generated attachment as a reference. The completed image is automatically shown and attached for the user; do not attach it again. Returns its attachment ID, workspace path, and a preview.`,
    parameters: Type.Object({
      prompt: Type.String({ minLength: 1, maxLength: 32000 }),
      referenceImages: Type.Optional(Type.Array(Type.Union([
        Type.Object({ attachmentId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
        Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
      ]), { maxItems: maxReferenceImages })),
      filename: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    }, { additionalProperties: false }),
    execute: async (id, rawArgs, signal) => {
      const parsed = imageGenerationInputSchema.safeParse(rawArgs)
      if (!parsed.success) throw new Error('Invalid image generation arguments: provide a prompt and attachment IDs or workspace paths')
      await input.onStarted(id)
      try {
        const result = await input.execute(id, parsed.data, signal)
        await input.onAttachment(id, result)
        return {
          content: [
            { type: 'text' as const, text: `Generated ${result.attachment.name}. Attachment ID: ${result.attachment.id}. Workspace path: ${result.path}. The image is already attached for the user.${result.metadata.text ? `\n${result.metadata.text}` : ''}` },
            { type: 'image' as const, mimeType: 'image/webp', data: result.previewData },
          ],
          details: { attachment: result.attachment, provider: result.model.adapter, billedCostMicros: result.billedCostMicros,
            imagePreview: { attachmentId: result.attachment.id, name: result.attachment.name, mimeType: result.attachment.mimeType, sizeBytes: result.attachment.sizeBytes } },
        }
      } catch (error) {
        if (signal?.aborted) throw new Error('Image generation was cancelled or timed out')
        if (error instanceof AppError || error instanceof ImageGenerationError) throw new Error(error.message)
        throw new Error('Image generation failed; any saved image remains in this chat. This request will not be repeated automatically.')
      }
    },
  }]
}
