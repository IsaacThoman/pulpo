import { describe, expect, it, vi } from 'vitest'
import { META_MUSE_IMAGE_PRESET, IMAGE_MODEL_PRESETS, type ImageModel } from '@pulpo/contracts'
import { createImageGenerationTools } from './tool.js'
import { ImageGenerationError } from './provider.js'
import { validateToolCall } from '@earendil-works/pi-ai'
const fixture = {
  file: { name: 'fox.png', mimeType: 'image/png', sizeBytes: 100 },
  path: '/workspace/fox.png', metadata: { text: 'A fox.' }, billedCostMicros: 10_000,
  model: { ...META_MUSE_IMAGE_PRESET, id: 'muse', providerConnectionId: '11111111-1111-4111-8111-111111111111' },
}
describe('generate_image tool', () => {
  it.each(['auto', '1:1', '3:2', '2:3'])('passes %s framing through tool validation and execution', async aspectRatio => {
    const execute = vi.fn().mockResolvedValue(fixture)
    const tool = createImageGenerationTools({ model: fixture.model, execute, onStarted: vi.fn() })[0]!
    const args = validateToolCall([tool], { type: 'toolCall', id: 'call', name: 'generate_image', arguments: { prompt: 'A fox', aspectRatio } })
    await tool.execute('call', args)
    expect(execute).toHaveBeenCalledExactlyOnceWith('call', { prompt: 'A fox', aspectRatio }, undefined)
    expect(() => validateToolCall([tool], { type: 'toolCall', id: 'bad', name: 'generate_image', arguments: { prompt: 'A fox', aspectRatio: 'invalid' } })).toThrow()
    await expect(tool.execute('bad', { prompt: 'A fox', aspectRatio: 'invalid' })).rejects.toThrow('Invalid image generation arguments')
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it.each(['azure-mai', 'meta-muse', 'openai-images'] as const)('accepts path shorthand through the actual %s tool validator and executes canonical arguments', async adapter => {
    const execute = vi.fn().mockResolvedValue(fixture)
    const tool = createImageGenerationTools({ model: { ...fixture.model, ...IMAGE_MODEL_PRESETS[adapter] }, execute, onStarted: vi.fn() })[0]!
    const args = validateToolCall([tool], { type: 'toolCall', id: 'call', name: 'generate_image', arguments: { prompt: 'Edit', referenceImages: ['/workspace/photo.jpeg'] } })
    await tool.execute('call', args)
    expect(execute).toHaveBeenCalledExactlyOnceWith('call', { prompt: 'Edit', referenceImages: [{ path: '/workspace/photo.jpeg' }] }, undefined)
    expect(tool.description).toContain('[{"path":"/workspace/photo.jpeg"}]')
  })
  it('rejects malformed shorthand and adapter-specific reference counts before execution', async () => {
    const execute = vi.fn()
    const tool = createImageGenerationTools({ model: { ...fixture.model, ...IMAGE_MODEL_PRESETS['azure-mai'] }, execute, onStarted: vi.fn() })[0]!
    for (const referenceImages of [['/etc/photo.jpeg'], ['https://example.com/image.png'], ['11111111-1111-4111-8111-111111111111'], ['/workspace/'], ['/workspace/a\0.jpg'], ['/workspace/a.png', '/workspace/b.png']]) {
      expect(() => validateToolCall([tool], { type: 'toolCall', id: 'call', name: 'generate_image', arguments: { prompt: 'Edit', referenceImages } })).toThrow()
    }
    await expect(tool.execute('call', { prompt: 'Edit', referenceImages: ['https://example.com/image.png'] })).rejects.toThrow('Invalid image generation arguments')
    expect(execute).not.toHaveBeenCalled()
  })
  it.each<[ImageModel['adapter'], number, boolean]>([['azure-mai', 1, false], ['meta-muse', 4, true], ['openai-images', 4, true]])('describes and limits references for %s', (adapter, maxItems, webp) => {
    const tool = createImageGenerationTools({ model: { ...fixture.model, ...IMAGE_MODEL_PRESETS[adapter] }, execute: vi.fn(), onStarted: vi.fn() })[0]!
    expect(tool.parameters).toMatchObject({ properties: { referenceImages: { maxItems } } })
    expect(tool.description).toContain(`up to ${maxItems} reference`)
    expect(tool.description.includes('webp')).toBe(webp)
  })
  it('is absent when unavailable and excludes model/credential overrides from its schema', () => {
    const callbacks = { execute: vi.fn(), onStarted: vi.fn() }
    expect(createImageGenerationTools({ model: null, ...callbacks })).toEqual([])
    const tool = createImageGenerationTools({ model: fixture.model, ...callbacks })[0]!
    expect(Object.keys((tool.parameters as unknown as { properties: object }).properties)).toEqual(['prompt', 'aspectRatio', 'referenceImages', 'filename'])
    expect(tool.parameters).toMatchObject({ additionalProperties: false })
  })
  it('returns only the workspace file and explicitly requires attach_file for visibility', async () => {
    const onStarted = vi.fn(), execute = vi.fn().mockResolvedValue(fixture)
    const tool = createImageGenerationTools({ model: fixture.model, execute, onStarted })[0]!
    const result = await tool.execute('call', { prompt: 'A fox' }, undefined)
    expect(onStarted).toHaveBeenCalledExactlyOnceWith('call')
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('You MUST call attach_file with {"path":"/workspace/fox.png"}') }])
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('NOT attached or visible to the user') })
    expect(result.details).toMatchObject({ path: '/workspace/fox.png', file: fixture.file, billedCostMicros: 10_000 })
    expect(result.details).not.toHaveProperty('attachment')
    expect(result.details).not.toHaveProperty('imagePreview')
    expect(tool.description).toContain('Saves the result only in the workspace')
  })
  it('rejects malicious arguments and sanitizes unexpected execution failures', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('secret provider key'))
    const tool = createImageGenerationTools({ model: fixture.model, execute, onStarted: vi.fn() })[0]!
    await expect(tool.execute('call', { prompt: 'Fox', modelId: 'override' }, undefined)).rejects.toThrow('Invalid image generation arguments')
    expect(execute).not.toHaveBeenCalled()
    await expect(tool.execute('call', { prompt: 'Fox' }, undefined)).rejects.toThrow('Image generation failed')
    execute.mockRejectedValueOnce(new ImageGenerationError('Image provider rate limit reached'))
    await expect(tool.execute('call', { prompt: 'Fox' }, undefined)).rejects.toThrow('rate limit')
  })
})
