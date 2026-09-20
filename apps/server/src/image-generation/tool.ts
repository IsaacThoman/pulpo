/* eslint-disable preserve-caught-error -- Tool errors cross the model boundary; never attach raw provider causes. */
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { imageGenerationInputSchema, IMAGE_ASPECT_RATIOS, IMAGE_PROVIDER_CAPABILITIES, IMAGE_REFERENCE_PATH_SHORTHAND_PATTERN, type ImageGenerationInput, type ImageModel } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'
import { ImageGenerationError } from './provider.js'
import type { ImageExecutionResult } from './service.js'

export function createImageGenerationTools(input: {
  model: ImageModel | null
  execute: (id: string, args: ImageGenerationInput, signal?: AbortSignal) => Promise<ImageExecutionResult>
  onStarted: (id: string) => void | Promise<void>
}): AgentTool[] {
  if (!input.model) return []
  const { maxReferenceImages, inputMimeTypes } = IMAGE_PROVIDER_CAPABILITIES[input.model.adapter]
  return [{
    name: 'generate_image', label: 'Generate image', executionMode: 'sequential',
    description: `Generate or edit an image using the image model selected in the user’s Settings. Supply a detailed text prompt and optional reference images from chat attachments or workspace files. Prefer referenceImages: [{"path":"/workspace/photo.jpeg"}] for files or [{"attachmentId":"ATTACHMENT-UUID"}] for attachments. A workspace path string is also accepted; attachment IDs must use the explicit object form. This model accepts up to ${maxReferenceImages} reference image(s) in ${inputMimeTypes.map(type => type.replace('image/', '')).join(', ')} format. For edits, use the previous generated workspace path or an attached image as a reference. Saves the result only in the workspace and returns its path. The user cannot see the image until you explicitly call attach_file with that path. You MUST attach the file if you want the user to see it. You may inspect it with view_image first. If an edit fails, report the stated reason; do not guess a policy restriction or repeatedly retry the same image with reworded prompts.`,
    parameters: Type.Object({
      prompt: Type.String({ minLength: 1, maxLength: 32000 }),
      aspectRatio: Type.Optional(Type.Union(IMAGE_ASPECT_RATIOS.map(ratio => Type.Literal(ratio)), {
        description: 'Defaults to auto: let the image model choose framing from the prompt and references. Use 1:1 for square, 3:2 for landscape, or 2:3 for portrait when requested. For edits, ask in the prompt to preserve the reference aspect ratio unless the user requests a change. Other ratios can be described in the prompt with auto. OpenAI enforces explicit sizes; Azure enforces them for new images. Azure edits and Muse receive a prompt instruction, so exact proportions are not guaranteed.',
      })),
      referenceImages: Type.Optional(Type.Array(Type.Union([
        Type.Object({ attachmentId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
        Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
        Type.String({ maxLength: 4096, pattern: IMAGE_REFERENCE_PATH_SHORTHAND_PATTERN }),
      ]), { maxItems: maxReferenceImages })),
      filename: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    }, { additionalProperties: false }),
    execute: async (id, rawArgs, signal) => {
      const parsed = imageGenerationInputSchema.safeParse(rawArgs)
      if (!parsed.success) throw new Error('Invalid image generation arguments: provide a prompt and attachment IDs or workspace paths')
      await input.onStarted(id)
      try {
        const result = await input.execute(id, parsed.data, signal)
        return {
          content: [{ type: 'text' as const, text: `Saved ${result.file.name} to ${result.path} (${result.file.mimeType}, ${result.file.sizeBytes} bytes).${result.metadata.text ? `\n${result.metadata.text}` : ''}\nThe image is only saved in the workspace; it is NOT attached or visible to the user. You MUST call attach_file with {"path":${JSON.stringify(result.path)}} if you want the user to see or download it.` }],
          details: { path: result.path, file: result.file, provider: result.model.adapter, billedCostMicros: result.billedCostMicros },
        }
      } catch (error) {
        if (signal?.aborted) throw new Error('Image generation was cancelled or timed out')
        if (error instanceof AppError || error instanceof ImageGenerationError) throw new Error(error.message)
        throw new Error('Image generation failed; any saved image remains in the workspace. This request will not be repeated automatically.')
      }
    },
  }]
}
