import { z } from 'zod'
import { imageModelSchema, type ImageModel } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const modalities = z.object({ text_tokens: count, image_tokens: count })
const usageSchema = z.object({
  input_tokens: count, output_tokens: count, total_tokens: count,
  input_tokens_details: z.object({
    text_tokens: count.optional(), image_tokens: count.optional(), cached_tokens: count.optional(),
    cached_tokens_details: modalities.optional(),
  }).optional(),
  output_tokens_details: z.object({ text_tokens: count.optional(), image_tokens: count.optional(), reasoning_tokens: count.optional() }).optional(),
})
export interface ImageUsage {
  inputTokens: number; outputTokens: number; totalTokens: number
  inputDetails?: { textTokens?: number; imageTokens?: number; cachedTokens?: number; cachedDetails?: { textTokens: number; imageTokens: number } }
  outputDetails?: { textTokens?: number; imageTokens?: number; reasoningTokens?: number }
}

/** Keep absent usage absent. Invalid provider numbers must never become free tokens. */
export function parseImageUsage(value: unknown): ImageUsage | undefined {
  const parsed = usageSchema.safeParse(value)
  if (!parsed.success) return undefined
  const usage = parsed.data, input = usage.input_tokens_details, output = usage.output_tokens_details
  return {
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens,
    ...(input ? { inputDetails: {
      ...(input.text_tokens !== undefined ? { textTokens: input.text_tokens } : {}),
      ...(input.image_tokens !== undefined ? { imageTokens: input.image_tokens } : {}),
      ...(input.cached_tokens !== undefined ? { cachedTokens: input.cached_tokens } : {}),
      ...(input.cached_tokens_details ? { cachedDetails: { textTokens: input.cached_tokens_details.text_tokens, imageTokens: input.cached_tokens_details.image_tokens } } : {}),
    } } : {}),
    ...(output ? { outputDetails: {
      ...(output.text_tokens !== undefined ? { textTokens: output.text_tokens } : {}),
      ...(output.image_tokens !== undefined ? { imageTokens: output.image_tokens } : {}),
      ...(output.reasoning_tokens !== undefined ? { reasoningTokens: output.reasoning_tokens } : {}),
    } } : {}),
  }
}
const invalidUsage = () => new AppError(502, 'image_usage_invalid', 'Image provider returned missing or invalid token usage; no image was charged. Contact an admin.')
function checked(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) throw invalidUsage()
  return value
}
function split(text: number | undefined, image: number | undefined, total: number): [number, number] {
  const t = checked(text), i = checked(image)
  if (BigInt(t) + BigInt(i) !== BigInt(total)) throw invalidUsage()
  return [t, i]
}

/** Snapshot config is normalized here as legacy operations have no billingUnit. */
export function imageCost(snapshot: ImageModel, usage?: ImageUsage): number {
  const model = imageModelSchema.parse(snapshot)
  if (!model.billUsers) return 0
  if (model.billingUnit === 'images') return model.imagePriceMicros
  if (!usage) throw invalidUsage()
  const input = checked(usage.inputTokens), output = checked(usage.outputTokens), total = checked(usage.totalTokens)
  if (BigInt(input) + BigInt(output) !== BigInt(total)) throw invalidUsage()
  const details = usage.inputDetails
  const cached = checked(details?.cachedTokens ?? 0)
  if (cached > input) throw invalidUsage()
  const reasoning = checked(usage.outputDetails?.reasoningTokens ?? 0)
  if (reasoning > output) throw invalidUsage()
  const prices = model.tokenPrices
  const charge = (tokens: number, rate: number | null) => {
    if (rate === null) throw invalidUsage()
    return BigInt(tokens) * BigInt(rate)
  }
  let numerator: bigint
  if (model.adapter === 'meta-muse') {
    if (details?.textTokens !== undefined || details?.imageTokens !== undefined) split(details.textTokens, details.imageTokens, input)
    if (usage.outputDetails?.textTokens !== undefined || usage.outputDetails?.imageTokens !== undefined) split(usage.outputDetails.textTokens, usage.outputDetails.imageTokens, output)
    if (details?.cachedDetails) {
      const [cachedText, cachedImage] = split(details.cachedDetails.textTokens, details.cachedDetails.imageTokens, cached)
      if ((details.textTokens !== undefined && cachedText > details.textTokens) || (details.imageTokens !== undefined && cachedImage > details.imageTokens)) throw invalidUsage()
    }
    numerator = charge(input - cached, prices.input) + charge(cached, prices.cachedInput) + charge(output, prices.output)
  } else {
    const [textInput, imageInput] = split(details?.textTokens, details?.imageTokens, input)
    // Older Images responses report only output_tokens, all of which are image tokens.
    const [textOutput, imageOutput] = usage.outputDetails?.textTokens !== undefined || usage.outputDetails?.imageTokens !== undefined
      ? split(usage.outputDetails.textTokens, usage.outputDetails.imageTokens, output) : [0, output]
    let cachedText = 0, cachedImage = 0
    if (details?.cachedDetails) [cachedText, cachedImage] = split(details.cachedDetails.textTokens, details.cachedDetails.imageTokens, cached)
    else if (cached > 0) {
      if (imageInput === 0) cachedText = cached
      else if (textInput === 0) cachedImage = cached
      else throw invalidUsage() // Mixed input with no cache attribution cannot be priced accurately.
    }
    if (cachedText > textInput || cachedImage > imageInput) throw invalidUsage()
    numerator = charge(textInput - cachedText, prices.input) + charge(cachedText, prices.cachedInput)
      + charge(imageInput - cachedImage, prices.imageInput) + charge(cachedImage, prices.cachedImageInput)
      + charge(textOutput, prices.output) + charge(imageOutput, prices.imageOutput)
  }
  const cost = Number((numerator + 999_999n) / 1_000_000n)
  if (!Number.isSafeInteger(cost)) throw invalidUsage()
  return cost
}

export function imageReservation(model: ImageModel): number {
  return model.billUsers ? model.billingUnit === 'tokens' ? model.reservationMicros : model.imagePriceMicros : 0
}
