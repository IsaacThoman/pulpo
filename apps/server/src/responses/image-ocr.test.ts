import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  aggregateOcrStatus,
  interceptAgentContextImages,
  interceptOpenAIInputImages,
  type ModelImageInterceptor,
  type OcrModel,
} from './image-ocr.js'

const enabledModel: OcrModel = { id: 'vision-with-ocr', interceptImagesWithOcr: true }
const disabledModel: OcrModel = { id: 'vision-without-ocr', interceptImagesWithOcr: false }

describe('model-bound image OCR adapters', () => {
  it('replaces view_image bytes without mutating agent state', async () => {
    const raw = Buffer.from('pixels').toString('base64')
    const context = {
      systemPrompt: 'system',
      messages: [{
        role: 'toolResult',
        toolName: 'view_image',
        toolCallId: 'view-1',
        content: [
          { type: 'text', text: 'Viewed /tmp/chart.png (image/png, 6 bytes)' },
          { type: 'image', data: raw, mimeType: 'image/png' },
        ],
      }],
    }
    const intercept = vi.fn().mockResolvedValue('[OCR text from /tmp/chart.png]\nRevenue: $10')
    const transformed = await interceptAgentContextImages(context, enabledModel, { intercept })

    expect(intercept).toHaveBeenCalledWith(enabledModel, expect.objectContaining({
      data: Buffer.from('pixels'),
      mimeType: 'image/png',
      label: '/tmp/chart.png',
    }))
    expect(JSON.stringify(transformed)).not.toContain(raw)
    expect(transformed.messages[0]!.content[1]).toEqual({ type: 'text', text: '[OCR text from /tmp/chart.png]\nRevenue: $10' })
    expect(context.messages[0]!.content[1]).toEqual({ type: 'image', data: raw, mimeType: 'image/png' })
  })

  it('reevaluates the active model on each agent invocation', async () => {
    const raw = Buffer.from('pixels').toString('base64')
    const context = { messages: [{ role: 'toolResult', toolName: 'view_image', content: [{ type: 'image', data: raw, mimeType: 'image/png' }] }] }
    const interceptor: ModelImageInterceptor = {
      intercept: vi.fn(async (model) => model.interceptImagesWithOcr ? 'ocr text' : null),
    }

    const primary = await interceptAgentContextImages(context, enabledModel, interceptor)
    const fallback = await interceptAgentContextImages(context, disabledModel, interceptor)

    expect(primary.messages[0]!.content[0]).toEqual({ type: 'text', text: 'ocr text' })
    expect(fallback.messages[0]!.content[0]).toEqual({ type: 'image', data: raw, mimeType: 'image/png' })
    expect(interceptor.intercept).toHaveBeenCalledTimes(2)
  })

  it('uses attachment metadata for prompt images and removes it before provider submission', async () => {
    const raw = Buffer.from('attached pixels').toString('base64')
    const context = { messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image.' },
        {
          type: 'image',
          data: raw,
          mimeType: 'image/png',
          label: 'vacation.png',
          attachmentId: 'attachment-1',
          sourceChecksum: 'checksum-1',
        },
      ],
    }] }
    const intercept = vi.fn().mockResolvedValue(null)

    const transformed = await interceptAgentContextImages(context, disabledModel, { intercept })

    expect(intercept).toHaveBeenCalledWith(disabledModel, expect.objectContaining({
      data: Buffer.from('attached pixels'),
      mimeType: 'image/png',
      label: 'vacation.png',
      attachmentId: 'attachment-1',
      sourceChecksum: 'checksum-1',
    }))
    expect(transformed.messages[0]!.content[1]).toEqual({ type: 'image', data: raw, mimeType: 'image/png' })
    expect(context.messages[0]!.content[1]).toHaveProperty('attachmentId', 'attachment-1')
  })

  it('replaces embedded OpenAI data URL images and preserves other parts', async () => {
    const raw = Buffer.from('image bytes')
    const input = [{ role: 'user', content: [
      { type: 'input_text', text: 'read this' },
      { type: 'input_image', image_url: `data:image/webp;base64,${raw.toString('base64')}` },
    ] }]
    const intercept = vi.fn().mockResolvedValue('ocr output')

    const transformed = await interceptOpenAIInputImages(input, enabledModel, { intercept }) as typeof input

    expect(transformed[0]!.content).toEqual([
      { type: 'input_text', text: 'read this' },
      { type: 'input_text', text: 'ocr output' },
    ])
    expect(intercept).toHaveBeenCalledWith(enabledModel, expect.objectContaining({ data: raw, mimeType: 'image/webp' }))
    expect(input[0]!.content[1]).toHaveProperty('type', 'input_image')
  })

  it('normalizes EXIF orientation in embedded OpenAI images before model use', async () => {
    const source = await sharp({
      create: { width: 120, height: 80, channels: 3, background: '#22c55e' },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const imageUrl = `data:image/jpeg;base64,${source.toString('base64')}`
    const input = [{ role: 'user', content: [{ type: 'input_image', image_url: imageUrl }] }]

    const transformed = await interceptOpenAIInputImages(
      input,
      disabledModel,
      { intercept: vi.fn().mockResolvedValue(null) },
    ) as typeof input

    const outputUrl = transformed[0]!.content[0]!.image_url
    const output = Buffer.from(outputUrl.slice(outputUrl.indexOf(',') + 1), 'base64')
    const metadata = await sharp(output).metadata()

    expect(metadata.width).toBe(80)
    expect(metadata.height).toBe(120)
    expect(metadata.orientation).toBeUndefined()
    expect(input[0]!.content[0]!.image_url).toBe(imageUrl)
  })

  it('normalizes EXIF orientation in view_image results before model use', async () => {
    const source = await sharp({
      create: { width: 90, height: 60, channels: 3, background: '#eab308' },
    }).jpeg().withMetadata({ orientation: 8 }).toBuffer()
    const raw = source.toString('base64')
    const context = {
      messages: [{
        role: 'toolResult',
        toolName: 'view_image',
        content: [{ type: 'image', data: raw, mimeType: 'image/jpeg' }],
      }],
    }

    const transformed = await interceptAgentContextImages(
      context,
      disabledModel,
      { intercept: vi.fn().mockResolvedValue(null) },
    )
    const image = transformed.messages[0]!.content[0]!
    const metadata = await sharp(Buffer.from(image.data, 'base64')).metadata()

    expect(metadata.width).toBe(60)
    expect(metadata.height).toBe(90)
    expect(metadata.orientation).toBeUndefined()
    expect(context.messages[0]!.content[0]!.data).toBe(raw)
  })

  it('keeps failed status monotonic across later successes', () => {
    expect(aggregateOcrStatus('not_requested', 'completed')).toBe('completed')
    expect(aggregateOcrStatus('completed', 'failed')).toBe('failed')
    expect(aggregateOcrStatus('failed', 'completed')).toBe('failed')
  })
})
