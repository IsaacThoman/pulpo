import { describe, expect, it, vi } from 'vitest'
import { META_MUSE_IMAGE_PRESET } from '@pulpo/contracts'
import { createImageGenerationTools } from './tool.js'
import { ImageGenerationError } from './provider.js'
import { messagesForPersistence } from '../agent/context.js'
import { adaptToolResultImagesForProvider } from '../agent/tool-result-images.js'
import type { Context } from '@earendil-works/pi-ai'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
const fixture = {
  attachment: { id: '11111111-1111-4111-8111-111111111111', name: 'fox.png', mimeType: 'image/png', sizeBytes: 100 },
  path: '/workspace/fox.png', previewData: 'BINARY_IMAGE_BYTES', metadata: { text: 'A fox.' }, billedCostMicros: 10_000,
  model: { ...META_MUSE_IMAGE_PRESET, id: 'muse', providerConnectionId: '11111111-1111-4111-8111-111111111111' },
}
describe('generate_image tool', () => {
  it('is absent when unavailable and excludes model/credential overrides from its schema', () => {
    const callbacks = { execute: vi.fn(), onStarted: vi.fn(), onAttachment: vi.fn() }
    expect(createImageGenerationTools({ available: false, ...callbacks })).toEqual([])
    const tool = createImageGenerationTools({ available: true, ...callbacks })[0]!
    expect(Object.keys((tool.parameters as unknown as { properties: object }).properties)).toEqual(['prompt', 'referenceImages', 'filename'])
    expect(tool.parameters).toMatchObject({ additionalProperties: false })
  })
  it('publishes its attachment and keeps bytes only in model-facing image content', async () => {
    const onAttachment = vi.fn(), onStarted = vi.fn(), execute = vi.fn().mockResolvedValue(fixture)
    const tool = createImageGenerationTools({ available: true, execute, onStarted, onAttachment })[0]!
    const result = await tool.execute('call', { prompt: 'A fox' }, undefined)
    expect(onStarted).toHaveBeenCalledExactlyOnceWith('call'); expect(onAttachment).toHaveBeenCalledWith('call', fixture)
    expect(JSON.stringify(result.details)).not.toContain(fixture.previewData)
    expect(result.details).toMatchObject({ imagePreview: { attachmentId: fixture.attachment.id, mimeType: 'image/png' } })
    const messages = [{ role: 'toolResult', toolCallId: 'call', toolName: 'generate_image', content: result.content, isError: false, timestamp: 1 }] as AgentMessage[]
    expect(JSON.stringify(messagesForPersistence(messages))).not.toContain(fixture.previewData)
    const context = { messages } as Context
    expect(adaptToolResultImagesForProvider(context, 'native')).toBe(context)
    const adapted = adaptToolResultImagesForProvider(context, 'user_message')
    expect(adapted.messages[0]!.content).toHaveLength(1)
    expect(adapted.messages[1]).toMatchObject({ role: 'user', content: [{ type: 'text', text: expect.stringContaining('generate_image tool') }, { type: 'image', data: fixture.previewData }] })
  })
  it('rejects malicious arguments and sanitizes unexpected execution failures', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('secret provider key'))
    const tool = createImageGenerationTools({ available: true, execute, onStarted: vi.fn(), onAttachment: vi.fn() })[0]!
    await expect(tool.execute('call', { prompt: 'Fox', modelId: 'override' }, undefined)).rejects.toThrow('Invalid image generation arguments')
    expect(execute).not.toHaveBeenCalled()
    await expect(tool.execute('call', { prompt: 'Fox' }, undefined)).rejects.toThrow('Image generation failed')
    execute.mockRejectedValueOnce(new ImageGenerationError('Image provider rate limit reached'))
    await expect(tool.execute('call', { prompt: 'Fox' }, undefined)).rejects.toThrow('rate limit')
  })
})
