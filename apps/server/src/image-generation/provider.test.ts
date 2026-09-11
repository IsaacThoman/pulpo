import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { AZURE_MAI_IMAGE_PRESET, META_MUSE_IMAGE_PRESET, OPENAI_IMAGE_PRESET, type ImageModel } from '@pulpo/contracts'
import { generateImage, imageProviderEndpoint, validateImageBytes } from './provider.js'
const model = (meta = false): ImageModel => ({ ...(meta ? META_MUSE_IMAGE_PRESET : AZURE_MAI_IMAGE_PRESET), id: 'image', providerConnectionId: '11111111-1111-4111-8111-111111111111' })
const png = () => sharp({ create: { width: 16, height: 16, channels: 3, background: '#f24' } }).png().toBuffer()
const options = (meta = false) => ({ model: model(meta), baseUrl: meta ? 'https://api.meta.ai/v1' : 'https://example.services.ai.azure.com', apiKey: 'SECRET', prompt: 'A red fox', references: [], signal: new AbortController().signal })
const openaiOptions = () => ({ ...options(), model: { ...model(), ...OPENAI_IMAGE_PRESET }, baseUrl: 'https://api.openai.com/v1' })
describe('image providers', () => {
  it('uses the OpenAI Images API with bearer auth, one PNG and optional token usage', async () => {
    const data = await png()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ b64_json: data.toString('base64') }], usage: { input_tokens: 12, output_tokens: 30, total_tokens: 42 } }))
    const result = await generateImage({ ...openaiOptions(), model: { ...openaiOptions().model, upstreamModelId: 'gpt-image-2.5-sunburst' }, fetch: fetcher })
    const [url, request] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/images/generations')
    expect(request).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer SECRET', 'Content-Type': 'application/json' } })
    expect(request!.headers).not.toHaveProperty('api-key')
    expect(JSON.parse(String(request!.body))).toEqual({ model: 'gpt-image-2.5-sunburst', prompt: 'A red fox', n: 1, size: '1024x1024', output_format: 'png' })
    expect(result).toEqual({ data, mimeType: 'image/png', text: '', usage: { inputTokens: 12, outputTokens: 30, totalTokens: 42 } })
    const withoutUsage = await generateImage({ ...openaiOptions(), fetch: async () => Response.json({ data: [{ b64_json: data.toString('base64') }] }) })
    expect(withoutUsage).not.toHaveProperty('usage')
  })
  it('uploads all OpenAI edit references as image[] files, including previous renders', async () => {
    const data = await png()
    const references = await Promise.all(['png', 'jpeg', 'webp', 'png'].map(async format => ({ data: await sharp(data).toFormat(format as 'png' | 'jpeg' | 'webp').toBuffer(), mimeType: `image/${format}` })))
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ b64_json: data.toString('base64') }] }))
    await generateImage({ ...openaiOptions(), references: references.map(reference => ({ ...reference, priorImageItem: { id: 'meta-image', type: 'image_generation_call', status: 'completed' } })), fetch: fetcher })
    const [url, request] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/images/edits')
    expect(request!.headers).toEqual({ Authorization: 'Bearer SECRET' })
    const form = request!.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('model')).toBe(OPENAI_IMAGE_PRESET.upstreamModelId)
    expect(form.get('prompt')).toBe('A red fox')
    expect(form.get('n')).toBe('1'); expect(form.get('size')).toBe('1024x1024'); expect(form.get('output_format')).toBe('png')
    expect(form.has('input')).toBe(false); expect(form.has('image')).toBe(false)
    const files = form.getAll('image[]') as File[]
    expect(files.map(file => file.name)).toEqual(['reference-1.png', 'reference-2.jpg', 'reference-3.webp', 'reference-4.png'])
    for (const [index, file] of files.entries()) {
      expect(file.type).toBe(references[index]!.mimeType)
      expect(Buffer.from(await file.arrayBuffer())).toEqual(references[index]!.data)
    }
    fetcher.mockClear()
    await expect(generateImage({ ...openaiOptions(), references: [...references, references[0]!], fetch: fetcher })).rejects.toThrow('at most 4')
    await expect(generateImage({ ...openaiOptions(), references: [{ data: Buffer.from('invalid'), mimeType: 'image/png' }], fetch: fetcher })).rejects.toThrow('Unsupported')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    ['https://api.openai.com', 'https://api.openai.com/v1/images/generations'],
    ['https://api.openai.com/v1/', 'https://api.openai.com/v1/images/generations'],
    ['https://proxy.example/api/openai/v1', 'https://proxy.example/api/openai/v1/images/generations'],
  ])('resolves OpenAI base URL %s', (baseUrl, expected) => {
    expect(imageProviderEndpoint(baseUrl, 'openai-images', false)).toBe(expected)
  })
  it.each(['https://user:secret@example.test/v1', 'https://example.test/v1?key=secret', 'https://example.test/v1#fragment'])('rejects unsafe URL components in %s', baseUrl => {
    expect(() => imageProviderEndpoint(baseUrl, 'openai-images', false)).toThrow('must not include')
  })
  it('rejects missing, multiple, URL-only and corrupt OpenAI results without fetching image URLs', async () => {
    const data = await png()
    for (const payload of [{ data: [] }, { data: [{ url: 'https://example.test/image.png' }] }, { data: [{ b64_json: 'AAAA' }] }, { data: [{ b64_json: data.toString('base64') }, { b64_json: data.toString('base64') }] }]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))
      await expect(generateImage({ ...openaiOptions(), fetch: fetcher })).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })
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
    for (const input of [options(), options(true), openaiOptions()]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('SECRET echoed prompt', { status }))
      await expect(generateImage({ ...input, fetch: fetcher })).rejects.toThrow(/^Image provider/)
      expect(fetcher).toHaveBeenCalledOnce()
    }
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
