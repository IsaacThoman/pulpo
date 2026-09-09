import { z } from 'zod'

export const imageGenerationPreferencesSchema = z.object({
  enabled: z.boolean().default(false),
  modelId: z.string().max(120).nullable().default(null),
}).default(() => ({ enabled: false, modelId: null }))
export type ImageGenerationPreferences = z.infer<typeof imageGenerationPreferencesSchema>

export const imageModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/),
  providerConnectionId: z.uuid(),
  adapter: z.enum(['azure-mai', 'meta-muse']),
  name: z.string().trim().min(1).max(120),
  upstreamModelId: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  billUsers: z.boolean().default(false),
  imagePriceMicros: z.number().int().min(0).max(1_000_000_000_000).default(0),
})
export type ImageModel = z.infer<typeof imageModelSchema>
export type PublicImageModel = Omit<ImageModel, 'providerConnectionId' | 'upstreamModelId'>
export const AZURE_MAI_IMAGE_PRESET = {
  adapter: 'azure-mai', name: 'MAI-Image-2.6-Flash', upstreamModelId: 'MAI-Image-2.6-Flash',
  enabled: false, sortOrder: 0, billUsers: false, imagePriceMicros: 0,
} satisfies Omit<ImageModel, 'id' | 'providerConnectionId'>
export const META_MUSE_IMAGE_PRESET = {
  ...AZURE_MAI_IMAGE_PRESET, adapter: 'meta-muse', name: 'Muse Image', upstreamModelId: 'muse-image-1.0',
} satisfies Omit<ImageModel, 'id' | 'providerConnectionId'>

export function imagePriceLabel(model: PublicImageModel): string {
  return model.billUsers ? `$${model.imagePriceMicros / 1e6} / image` : 'Free to use'
}

// Pulpo transport limits; adapters may impose stricter limits.
export const IMAGE_GENERATION_MAX_BYTES = 20 * 1024 * 1024
export const imageGenerationInputSchema = z.object({
  prompt: z.string().trim().min(1).max(32_000),
  referenceImages: z.array(z.union([
    z.object({ attachmentId: z.uuid() }).strict(),
    z.object({ path: z.string().trim().min(1).max(4096) }).strict(),
  ])).max(4).optional(),
  filename: z.string().trim().min(1).max(255).optional(),
}).strict()
export type ImageGenerationInput = z.infer<typeof imageGenerationInputSchema>
