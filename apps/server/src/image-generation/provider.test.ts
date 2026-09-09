import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { AZURE_MAI_IMAGE_PRESET, META_MUSE_IMAGE_PRESET, type ImageModel } from '@pulpo/contracts'
import { generateImage, imageProviderEndpoint, validateImageBytes } from './provider.js'
const model = (meta = false): ImageModel => ({ ...(meta ? META_MUSE_IMAGE_PRESET : AZURE_MAI_IMAGE_PRESET), id: 'image', providerConnectionId: '11111111-1111-4111-8111-111111111111' })
const png = () => sharp({ create: { width: 16, height: 16, channels: 3, background: '#f24' } }).png().toBuffer()
const options = (meta = false) => ({ model: model(meta), baseUrl: meta ? 'https://api.meta.ai/v1' : 'https://example.services.ai.azure.com', apiKey: 'SECRET', prompt: 'A red fox', references: [], signal: new AbortController().signal })
describe('image providers', () => {
  it('uses Azure JSON generations with deployment names, PNG output and no retries', async () => {
    const data = await png()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ b64_json: data.toString('base64') }] }))
    const result = await generateImage({ ...options(), model: { ...model(), upstreamModelId: 'my-deployment' }, fetch: fetcher })
    const [url, request] = fetcher.mock.calls[0]!
    expect(url).toBe('https://example.services.ai.azure.com/mai/v1/images/generations')
    expect(request).toMatchObject({ redirect: 'error', headers: { 'api-key': 'SECRET' } })
    expect(JSON.parse(String(request!.body))).toEqual({ model: 'my-deployment', prompt: 'A red fox', width: 1024, height: 1024 })
    expect(result.data).toEqual(data); expect(result.mimeType).toBe('image/png')
    expect(imageProviderEndpoint('https://example.test/mai/v1/', 'azure-mai', true)).toBe('https://example.test/mai/v1/images/edits')
    expect(() => imageProviderEndpoint('https://example.test/openai/v1', 'azure-mai', false)).toThrow('Foundry')
  })
  it('uses multipart edits and rejects excessive or unsupported references before HTTP', async () => {
    const data = await png(); const reference = { data, mimeType: 'image/png' }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ b64_json: data.toString('base64') }] }))
    await generateImage({ ...options(), references: [reference], fetch: fetcher })
    const [url, request] = fetcher.mock.calls[0]!
    expect(String(url)).toContain('/images/edits')
    expect(request!.body).toBeInstanceOf(FormData)
    const form = request!.body as FormData
    expect(form.get('prompt')).toBe('A red fox'); expect((form.get('image') as Blob).type).toBe('image/png')
    expect(request!.headers).not.toHaveProperty('Content-Type')
    fetcher.mockClear()
    await expect(generateImage({ ...options(), references: [reference, reference], fetch: fetcher })).rejects.toThrow('one reference')
    await expect(generateImage({ ...options(), references: [{ data: await sharp(data).webp().toBuffer(), mimeType: 'image/webp' }], fetch: fetcher })).rejects.toThrow('Unsupported')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('uses Meta Responses with stateless image replay and fresh image parts', async () => {
    const data = await png()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'response-2', status: 'completed', output: [
      { type: 'reasoning', text: 'private reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Here is the fox.' }] },
      { type: 'image_generation_call', id: 'image-2', status: 'completed', result: data.toString('base64') },
    ], usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } }))
    const result = await generateImage({ ...options(true), fetch: fetcher, references: [
      { data, mimeType: 'image/png', priorImageItem: { id: 'image-1', type: 'image_generation_call', status: 'completed' } },
      { data, mimeType: 'image/png' },
    ] })
    const [url, request] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.meta.ai/v1/responses')
    const body = JSON.parse(String(request!.body))
    expect(body).toMatchObject({ model: 'muse-image-1.0', store: false, input: [{ id: 'image-1', type: 'image_generation_call', result: data.toString('base64') }, { role: 'user', content: [{ type: 'input_text' }, { type: 'input_image' }] }] })
    expect(body).not.toHaveProperty('previous_response_id')
    expect(result.text).toBe('Here is the fox.'); expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 10, totalTokens: 50 })
    expect(result.imageItem).toEqual({ id: 'image-2', type: 'image_generation_call', status: 'completed' })
    expect(JSON.stringify(result)).not.toContain('private reasoning')
  })
  it.each([400, 401, 403, 404, 429, 500])('sanitizes HTTP %s without a retry', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('SECRET echoed prompt', { status }))
    await expect(generateImage({ ...options(), fetch: fetcher })).rejects.toThrow(/Image provider/)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('rejects refused, incomplete, malformed and oversized output', async () => {
    for (const payload of [{ status: 'in_progress' }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] }, { status: 'completed', output: [{ type: 'image_generation_call', status: 'completed', result: 'AAAA' }] }]) {
      await expect(generateImage({ ...options(true), fetch: async () => Response.json(payload) })).rejects.toThrow()
    }
    await expect(generateImage({ ...options(), fetch: async () => new Response('not-json') })).rejects.toThrow('invalid response')
    await expect(validateImageBytes(new Uint8Array(21 * 1024 * 1024))).rejects.toThrow('20 MiB')
  })
  it('honors cancellation and sanitizes network errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('SECRET upstream URL'))
    await expect(generateImage({ ...options(), fetch: fetcher })).rejects.toThrow('connection failed')
    fetcher.mockClear()
    await expect(generateImage({ ...options(), signal: AbortSignal.abort(), fetch: fetcher })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['headers', 'body'])('honors in-flight timeouts while reading response %s', async phase => {
    const signal = AbortSignal.timeout(20)
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (phase === 'headers') return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('SECRET transport diagnostic')), { once: true })
      })
      return new Response(new ReadableStream({
        start(controller) { signal.addEventListener('abort', () => controller.error(new Error('SECRET transport diagnostic')), { once: true }) },
      }))
    })
    await expect(generateImage({ ...options(), signal, fetch: fetcher })).rejects.toThrow('Image generation was cancelled or timed out')
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
