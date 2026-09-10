import sharp from 'sharp'
import { IMAGE_GENERATION_MAX_BYTES, type ImageModel } from '@pulpo/contracts'
import { detectImageMime } from '../agent/images.js'

export class ImageGenerationError extends Error {}

export interface ImageResultMetadata {
  text: string
  upstreamResponseId?: string
  imageItem?: { id: string; type: 'image_generation_call'; status: 'completed' }
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
}
export interface ImageReference {
  data: Uint8Array
  mimeType: string
  priorImageItem?: ImageResultMetadata['imageItem']
}
export interface GeneratedImageResult extends ImageResultMetadata { data: Uint8Array; mimeType: string }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}

export async function validateImageBytes(data: Uint8Array, allowed = ['image/png', 'image/jpeg', 'image/webp']): Promise<string> {
  if (!data.length || data.length > IMAGE_GENERATION_MAX_BYTES) throw new ImageGenerationError('Images must be nonempty and no larger than 20 MiB')
  const mimeType = detectImageMime(data)
  if (!mimeType || !allowed.includes(mimeType)) throw new ImageGenerationError(`Unsupported image format; use ${allowed.map(type => type.replace('image/', '')).join(', ')}`)
  try {
    const metadata = await sharp(data, { limitInputPixels: 40_000_000 }).metadata()
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new ImageGenerationError('Invalid image dimensions')
    // Decode pixels as well as headers so truncated/corrupt payloads never become attachments.
    await sharp(data, { limitInputPixels: 40_000_000 }).resize(1, 1).toBuffer()
  } catch { throw new ImageGenerationError('Image is invalid, animated, or exceeds 40 megapixels') }
  return mimeType
}

export function validateImageRequest(model: ImageModel, prompt: string, references: ImageReference[]) {
  if (!prompt.trim() || Buffer.byteLength(prompt, 'utf8') > 32_000) throw new ImageGenerationError('Image prompts must contain text and be at most 32,000 UTF-8 bytes')
  if (references.length > (model.adapter === 'azure-mai' ? 1 : 4)) throw new ImageGenerationError(model.adapter === 'azure-mai' ? 'MAI accepts one reference image per edit' : 'Use at most four reference images')
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const maxBytes = Math.ceil(IMAGE_GENERATION_MAX_BYTES * 4 / 3) + 1024 * 1024
  const reader = response.body?.getReader()
  if (!reader) throw new ImageGenerationError('Image provider returned an empty response')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxBytes) throw new ImageGenerationError('Image provider response exceeds the size limit')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
  catch { throw new ImageGenerationError('Image provider returned an invalid response') }
}

export function imageProviderEndpoint(baseUrl: string, adapter: ImageModel['adapter'], edit: boolean): string {
  const url = new URL(baseUrl)
  if (url.username || url.password || url.search || url.hash) throw new ImageGenerationError('Image provider URL must not include credentials, a query, or a fragment')
  const path = url.pathname.replace(/\/$/, '')
  if (adapter === 'azure-mai') {
    // Accept either the Foundry resource root or its MAI API base.
    if (path && path !== '/mai/v1') throw new ImageGenerationError('Use the Foundry resource URL or its /mai/v1 base for MAI')
    url.pathname = `/mai/v1/images/${edit ? 'edits' : 'generations'}`
  } else url.pathname = `${path || '/v1'}/responses`
  return url.toString()
}

export async function generateImage(input: {
  model: ImageModel; baseUrl: string; apiKey: string; prompt: string; references: ImageReference[]; signal: AbortSignal
  fetch?: typeof fetch
}): Promise<GeneratedImageResult> {
  const { model, prompt, references, signal } = input
  validateImageRequest(model, prompt, references)
  for (const reference of references) {
    reference.mimeType = await validateImageBytes(reference.data, model.adapter === 'azure-mai' ? ['image/png', 'image/jpeg'] : undefined)
  }
  signal.throwIfAborted()
  const headers: Record<string, string> = model.adapter === 'azure-mai' ? { 'api-key': input.apiKey } : { Authorization: `Bearer ${input.apiKey}` }
  let body: string | FormData
  if (model.adapter === 'azure-mai' && references.length) {
    const reference = references[0]!
    body = new FormData()
    body.set('model', model.upstreamModelId); body.set('prompt', prompt)
    body.set('image', new Blob([new Uint8Array(reference.data)], { type: reference.mimeType }), reference.mimeType === 'image/png' ? 'reference.png' : 'reference.jpg')
  } else {
    headers['Content-Type'] = 'application/json'
    const parts: Array<Record<string, unknown>> = [{ type: 'input_text', text: prompt }]
    const prior: Array<Record<string, unknown>> = []
    for (const reference of references) {
      const data = Buffer.from(reference.data).toString('base64')
      if (reference.priorImageItem) prior.push({ ...reference.priorImageItem, result: data })
      else parts.push({ type: 'input_image', image_url: `data:${reference.mimeType};base64,${data}` })
    }
    body = JSON.stringify(model.adapter === 'azure-mai'
      ? { model: model.upstreamModelId, prompt, width: 1024, height: 1024 }
      : { model: model.upstreamModelId, store: false, input: [...prior, { role: 'user', content: parts }] })
  }
  let response: Response
  try {
    response = await (input.fetch ?? fetch)(imageProviderEndpoint(input.baseUrl, model.adapter, references.length > 0), { method: 'POST', headers, body, signal, redirect: 'error' })
  } catch {
    throw new ImageGenerationError(signal.aborted ? 'Image generation was cancelled or timed out' : 'Image provider connection failed; this request will not be retried automatically')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    const message = response.status === 401 || response.status === 403 ? 'Image provider credentials or access are invalid; contact an admin'
      : response.status === 429 ? 'Image provider rate limit reached; try again later'
      : response.status === 400 ? 'Image provider rejected the prompt or image inputs'
      : response.status === 404 ? 'Image provider model or endpoint was not found; contact an admin'
      : 'Image provider generation failed'
    throw new ImageGenerationError(message)
  }
  const payload = await boundedJson(response).catch(error => {
    if (signal.aborted) throw new ImageGenerationError('Image generation was cancelled or timed out')
    if (error instanceof ImageGenerationError) throw error
    throw new ImageGenerationError('Image provider response was interrupted; this request will not be retried automatically')
  })
  let base64: unknown
  let metadata: ImageResultMetadata = { text: '' }
  if (model.adapter === 'azure-mai') {
    const images = Array.isArray(payload.data) ? payload.data : []
    if (images.length !== 1) throw new ImageGenerationError('Image provider did not return one generated image')
    base64 = object(images[0]).b64_json
  } else {
    if (payload.status !== 'completed') throw new ImageGenerationError('Image provider did not complete generation')
    const output = Array.isArray(payload.output) ? payload.output.map(object) : []
    const images = output.filter(item => item.type === 'image_generation_call' && item.status === 'completed')
    if (images.length !== 1) throw new ImageGenerationError('Image provider returned no completed image or refused the request')
    const item = images[0]!
    base64 = item.result
    const usage = object(payload.usage)
    const tokenCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
    metadata = {
      text: output.filter(item => item.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content.map(object).filter(part => part.type === 'output_text').map(part => typeof part.text === 'string' ? part.text : '') : []).join('\n').slice(0, 8000),
      ...(typeof payload.id === 'string' ? { upstreamResponseId: payload.id } : {}),
      ...(typeof item.id === 'string' ? { imageItem: { id: item.id, type: 'image_generation_call', status: 'completed' } } : {}),
      usage: { inputTokens: tokenCount(usage.input_tokens), outputTokens: tokenCount(usage.output_tokens), totalTokens: tokenCount(usage.total_tokens) },
    }
  }
  if (typeof base64 !== 'string' || !base64.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new ImageGenerationError('Image provider returned invalid image data')
  const data = Buffer.from(base64, 'base64')
  const mimeType = await validateImageBytes(data, model.adapter === 'azure-mai' ? ['image/png'] : undefined)
  signal.throwIfAborted()
  return { ...metadata, data, mimeType }
}
