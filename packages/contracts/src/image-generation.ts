import { z } from 'zod'

export const imageGenerationPreferencesSchema = z.object({
  enabled: z.boolean().default(false),
  modelId: z.string().max(120).nullable().default(null),
}).default(() => ({ enabled: false, modelId: null }))
export type ImageGenerationPreferences = z.infer<typeof imageGenerationPreferencesSchema>

export const imageDefaultsSchema = z.object({
  modelId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/).nullable().default(null),
})
export type ImageDefaults = z.infer<typeof imageDefaultsSchema>
// Optional for clients connected to servers predating instance image defaults.
export interface ImageCatalog { data: PublicImageModel[]; defaultModelId?: string | null }

const price = z.number().int().min(0).max(1_000_000_000_000)
/** Microdollars per million tokens; null means the administrator has not entered a rate. */
export const imageTokenPricesSchema = z.object({
  input: price.nullable().default(null),
  cachedInput: price.nullable().default(null),
  output: price.nullable().default(null),
  imageInput: price.nullable().default(null),
  cachedImageInput: price.nullable().default(null),
  imageOutput: price.nullable().default(null),
})
export type ImageTokenPrices = z.infer<typeof imageTokenPricesSchema>
export const IMAGE_TOKEN_RATE_LABELS: Record<keyof ImageTokenPrices, string> = {
  input: 'Input tokens', cachedInput: 'Cached input tokens', output: 'Output tokens',
  imageInput: 'Image input tokens', cachedImageInput: 'Cached image input tokens', imageOutput: 'Image output tokens',
}
export function imageTokenRateKeys(adapter: 'azure-mai' | 'meta-muse' | 'openai-images'): Array<keyof ImageTokenPrices> {
  return adapter === 'openai-images' ? ['input', 'cachedInput', 'imageInput', 'cachedImageInput', 'output', 'imageOutput'] : ['input', 'cachedInput', 'output']
}
export function imageTokenRateLabel(adapter: 'azure-mai' | 'meta-muse' | 'openai-images', key: keyof ImageTokenPrices): string {
  if (adapter === 'openai-images') {
    if (key === 'input') return 'Text input tokens'
    if (key === 'cachedInput') return 'Cached text input tokens'
    if (key === 'output') return 'Text output tokens'
  }
  return IMAGE_TOKEN_RATE_LABELS[key]
}

export const imageModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/),
  providerConnectionId: z.uuid(),
  adapter: z.enum(['azure-mai', 'meta-muse', 'openai-images']),
  name: z.string().trim().min(1).max(120),
  upstreamModelId: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  billUsers: z.boolean().default(false),
  imagePriceMicros: price.default(0),
  billingUnit: z.enum(['images', 'tokens']).default('images'),
  tokenPrices: imageTokenPricesSchema.default(() => imageTokenPricesSchema.parse({})),
  reservationMicros: price.default(0),
}).superRefine((model, ctx) => {
  if (model.billingUnit !== 'tokens') return
  if (model.adapter === 'azure-mai') ctx.addIssue({ code: 'custom', path: ['billingUnit'], message: 'Azure MAI does not report token usage; use per-image pricing.' })
  if (!model.billUsers) return
  if (model.reservationMicros <= 0) ctx.addIssue({ code: 'custom', path: ['reservationMicros'], message: 'Enter a positive upfront reservation.' })
  for (const key of imageTokenRateKeys(model.adapter)) {
    if (model.tokenPrices[key] === null) ctx.addIssue({ code: 'custom', path: ['tokenPrices', key], message: 'Enter a token rate (zero is allowed).' })
  }
})
export type ImageModel = z.infer<typeof imageModelSchema>
export type PublicImageModel = Omit<ImageModel, 'providerConnectionId' | 'upstreamModelId'>
export const AZURE_MAI_IMAGE_PRESET = {
  adapter: 'azure-mai', name: 'MAI-Image-2.6-Flash', upstreamModelId: 'MAI-Image-2.6-Flash',
  enabled: false, sortOrder: 0, billUsers: false, imagePriceMicros: 0,
  billingUnit: 'images', tokenPrices: imageTokenPricesSchema.parse({}), reservationMicros: 0,
} satisfies Omit<ImageModel, 'id' | 'providerConnectionId'>
export const META_MUSE_IMAGE_PRESET = {
  ...AZURE_MAI_IMAGE_PRESET, adapter: 'meta-muse', name: 'Muse Image', upstreamModelId: 'muse-image-1.0',
} satisfies Omit<ImageModel, 'id' | 'providerConnectionId'>
export const OPENAI_IMAGE_PRESET = {
  ...AZURE_MAI_IMAGE_PRESET, adapter: 'openai-images', name: 'GPT Image 2.5 Flare', upstreamModelId: 'gpt-image-2.5-flare',
  // Microdollars / 1M tokens, verified 2026-09-13: developers.openai.com/api/docs/models/gpt-image-2.5-flare
  tokenPrices: { input: 5_000_000, cachedInput: 1_250_000, imageInput: 8_000_000, cachedImageInput: 2_000_000, output: 0, imageOutput: 30_000_000 },
} satisfies Omit<ImageModel, 'id' | 'providerConnectionId'>

export const IMAGE_MODEL_PRESETS = {
  'azure-mai': AZURE_MAI_IMAGE_PRESET,
  'meta-muse': META_MUSE_IMAGE_PRESET,
  'openai-images': OPENAI_IMAGE_PRESET,
} satisfies Record<ImageModel['adapter'], Omit<ImageModel, 'id' | 'providerConnectionId'>>

// Pulpo's supported capabilities, which may be stricter than upstream limits.
export const IMAGE_PROVIDER_CAPABILITIES: Record<ImageModel['adapter'], {
  maxReferenceImages: number
  inputMimeTypes: readonly string[]
  outputMimeTypes: readonly string[]
  supportsImageItemReplay: boolean
}> = {
  'azure-mai': { maxReferenceImages: 1, inputMimeTypes: ['image/png', 'image/jpeg'], outputMimeTypes: ['image/png'], supportsImageItemReplay: false },
  'meta-muse': { maxReferenceImages: 4, inputMimeTypes: ['image/png', 'image/jpeg', 'image/webp'], outputMimeTypes: ['image/png', 'image/jpeg', 'image/webp'], supportsImageItemReplay: true },
  'openai-images': { maxReferenceImages: 4, inputMimeTypes: ['image/png', 'image/jpeg', 'image/webp'], outputMimeTypes: ['image/png'], supportsImageItemReplay: false },
}

export function imagePriceLabel(model: PublicImageModel, translate: (source: string) => string = value => value): string {
  if (!model.billUsers) return translate('Free to use')
  if (model.billingUnit !== 'tokens') return `$${model.imagePriceMicros / 1e6} / ${translate('image')}`
  return imageTokenRateKeys(model.adapter).map(key => `$${(model.tokenPrices[key] ?? 0) / 1e6} / 1M ${translate(imageTokenRateLabel(model.adapter, key))}`).join(' · ')
}

// Pulpo transport limits; adapters may impose stricter limits.
export const IMAGE_GENERATION_MAX_BYTES = 20 * 1024 * 1024
// Wire shorthand only; resolving the canonical path still requires workspace access checks.
export const IMAGE_REFERENCE_PATH_SHORTHAND_PATTERN = '^/workspace/[^\\u0000]+$'
export const imageGenerationInputSchema = z.object({
  prompt: z.string().trim().min(1).max(32_000),
  referenceImages: z.array(z.union([
    z.object({ attachmentId: z.uuid() }).strict(),
    z.object({ path: z.string().trim().min(1).max(4096) }).strict(),
    z.string().max(4096).regex(new RegExp(IMAGE_REFERENCE_PATH_SHORTHAND_PATTERN)),
  ]).transform(reference => typeof reference === 'string' ? { path: reference } : reference)).max(4).optional(),
  filename: z.string().trim().min(1).max(255).optional(),
}).strict()
export type ImageGenerationInput = z.infer<typeof imageGenerationInputSchema>
