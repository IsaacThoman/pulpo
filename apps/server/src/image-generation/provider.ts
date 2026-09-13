import sharp from 'sharp'
import { IMAGE_GENERATION_MAX_BYTES, IMAGE_PROVIDER_CAPABILITIES, type ImageModel } from '@pulpo/contracts'
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

export async function validateImageBytes(data: Uint8Array, allowed: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']): Promise<string> {
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
  const { maxReferenceImages } = IMAGE_PROVIDER_CAPABILITIES[model.adapter]
  if (references.length > maxReferenceImages) throw new ImageGenerationError(maxReferenceImages === 1 ? 'This image model accepts one reference image per edit' : `Use at most ${maxReferenceImages} reference images`)
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

interface ImageRequest {
  model: ImageModel
  apiKey: string
  prompt: string
  references: ImageReference[]
}
interface ImageAdapter {
  path: (basePath: string, edit: boolean) => string
  request: (input: ImageRequest) => { headers: Record<string, string>; body: string | FormData }
  result: (payload: Record<string, unknown>) => { base64: unknown; metadata: ImageResultMetadata }
}

function imageUsage(value: unknown): ImageResultMetadata['usage'] {
  const usage = object(value)
  const tokenCount = (count: unknown) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0
  return { inputTokens: tokenCount(usage.input_tokens), outputTokens: tokenCount(usage.output_tokens), totalTokens: tokenCount(usage.total_tokens) }
}

function imagesResult(payload: Record<string, unknown>) {
  const images = Array.isArray(payload.data) ? payload.data : []
  if (images.length !== 1) throw new ImageGenerationError('Image provider did not return one generated image')
  return { base64: object(images[0]).b64_json, metadata: { text: '', ...(payload.usage ? { usage: imageUsage(payload.usage) } : {}) } }
}

function imageForm(input: ImageRequest, imageField: string): FormData {
  const form = new FormData()
  form.set('model', input.model.upstreamModelId)
  form.set('prompt', input.prompt)
  for (const [index, reference] of input.references.entries()) {
    const extension = reference.mimeType === 'image/jpeg' ? 'jpg' : reference.mimeType === 'image/webp' ? 'webp' : 'png'
    form.append(imageField, new Blob([new Uint8Array(reference.data)], { type: reference.mimeType }), `reference-${index + 1}.${extension}`)
  }
  return form
}

const adapters: Record<ImageModel['adapter'], ImageAdapter> = {
  'azure-mai': {
    path: (path, edit) => {
      // Accept either the Foundry resource root or its MAI API base.
      if (path && path !== '/mai/v1') throw new ImageGenerationError('Use the Foundry resource URL or its /mai/v1 base for MAI')
      return `/mai/v1/images/${edit ? 'edits' : 'generations'}`
    },
    request: input => {
      const headers: Record<string, string> = { 'api-key': input.apiKey }
      if (input.references.length) return { headers, body: imageForm(input, 'image') }
      return { headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: input.model.upstreamModelId, prompt: input.prompt, width: 1024, height: 1024 }) }
    },
    result: imagesResult,
  },
  'openai-images': {
    path: (path, edit) => `${path || '/v1'}/images/${edit ? 'edits' : 'generations'}`,
    request: input => {
      const headers: Record<string, string> = { Authorization: `Bearer ${input.apiKey}` }
      const options = { n: 1, size: '1024x1024', output_format: 'png' }
      if (input.references.length) {
        const body = imageForm(input, 'image[]')
        for (const [key, value] of Object.entries(options)) body.set(key, String(value))
        return { headers, body }
      }
      return { headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: input.model.upstreamModelId, prompt: input.prompt, ...options }) }
    },
    result: imagesResult,
  },
  'meta-muse': {
    path: path => `${path || '/v1'}/responses`,
    request: ({ model, prompt, references, apiKey }) => {
      const parts: Array<Record<string, unknown>> = [{ type: 'input_text', text: prompt }]
      const prior: Array<Record<string, unknown>> = []
      for (const reference of references) {
        const data = Buffer.from(reference.data).toString('base64')
        if (reference.priorImageItem) prior.push({ ...reference.priorImageItem, result: data })
        else parts.push({ type: 'input_image', image_url: `data:${reference.mimeType};base64,${data}` })
      }
      return { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.upstreamModelId, store: false, input: [...prior, { role: 'user', content: parts }] }) }
    },
    result: payload => {
      if (payload.status !== 'completed') throw new ImageGenerationError('Image provider did not complete generation')
      const output = Array.isArray(payload.output) ? payload.output.map(object) : []
      const images = output.filter(item => item.type === 'image_generation_call' && item.status === 'completed')
      if (images.length !== 1) throw new ImageGenerationError('Image provider returned no completed image or refused the request')
      const item = images[0]!
      return { base64: item.result, metadata: {
        text: output.filter(item => item.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content.map(object).filter(part => part.type === 'output_text').map(part => typeof part.text === 'string' ? part.text : '') : []).join('\n').slice(0, 8000),
        ...(typeof payload.id === 'string' ? { upstreamResponseId: payload.id } : {}),
        ...(typeof item.id === 'string' ? { imageItem: { id: item.id, type: 'image_generation_call', status: 'completed' } } : {}),
        usage: imageUsage(payload.usage),
      } }
    },
  },
}

export function imageProviderEndpoint(baseUrl: string, adapter: ImageModel['adapter'], edit: boolean): string {
  const url = new URL(baseUrl)
  if (url.username || url.password || url.search || url.hash) throw new ImageGenerationError('Image provider URL must not include credentials, a query, or a fragment')
  url.pathname = adapters[adapter].path(url.pathname.replace(/\/$/, ''), edit)
  return url.toString()
}

export async function generateImage(input: {
  model: ImageModel; baseUrl: string; apiKey: string; prompt: string; references: ImageReference[]; signal: AbortSignal
  fetch?: typeof fetch
}): Promise<GeneratedImageResult> {
  const { model, prompt, references, signal } = input
  const capabilities = IMAGE_PROVIDER_CAPABILITIES[model.adapter]
  const adapter = adapters[model.adapter]
  validateImageRequest(model, prompt, references)
  for (const reference of references) {
    reference.mimeType = await validateImageBytes(reference.data, capabilities.inputMimeTypes)
  }
  signal.throwIfAborted()
  const { headers, body } = adapter.request(input)
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
  const { base64, metadata } = adapter.result(payload)
  if (typeof base64 !== 'string' || !base64.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new ImageGenerationError('Image provider returned invalid image data')
  const data = Buffer.from(base64, 'base64')
  const mimeType = await validateImageBytes(data, capabilities.outputMimeTypes)
  signal.throwIfAborted()
  return { ...metadata, data, mimeType }
}
