import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { loadAgentPromptImages, type AgentPromptImageAttachment } from './prompt-images.js'

describe('agent prompt images', () => {
  it('loads only images in attachment order and normalizes their orientation', async () => {
    const rotated = await sharp({
      create: { width: 120, height: 80, channels: 3, background: '#2563eb' },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const png = await sharp({
      create: { width: 20, height: 10, channels: 4, background: '#22c55e' },
    }).png().toBuffer()
    const attachments: AgentPromptImageAttachment[] = [
      { id: 'image-1', originalName: 'camera.jpg', mimeType: 'image/jpeg', objectKey: 'camera-key', checksum: 'camera-checksum' },
      { id: 'document-1', originalName: 'notes.pdf', mimeType: 'application/pdf', objectKey: 'notes-key', checksum: 'notes-checksum' },
      { id: 'image-2', originalName: 'chart.png', mimeType: 'image/png', objectKey: 'chart-key', checksum: 'chart-checksum' },
    ]
    const readAttachment = vi.fn(async (key: string) => {
      if (key === 'camera-key') return rotated
      if (key === 'chart-key') return png
      throw new Error(`Unexpected attachment read: ${key}`)
    })

    const images = await loadAgentPromptImages(attachments, readAttachment)

    expect(readAttachment.mock.calls.map(([key]) => key)).toEqual(['camera-key', 'chart-key'])
    expect(images.map(({ label, attachmentId, sourceChecksum, mimeType }) => ({ label, attachmentId, sourceChecksum, mimeType }))).toEqual([
      { label: 'camera.jpg', attachmentId: 'image-1', sourceChecksum: 'camera-checksum', mimeType: 'image/jpeg' },
      { label: 'chart.png', attachmentId: 'image-2', sourceChecksum: 'chart-checksum', mimeType: 'image/png' },
    ])
    const metadata = await sharp(Buffer.from(images[0]!.data, 'base64')).metadata()
    expect(metadata.width).toBe(80)
    expect(metadata.height).toBe(120)
    expect(metadata.orientation).toBeUndefined()
  })

  it('fails when an image attachment cannot be read', async () => {
    const attachment: AgentPromptImageAttachment = {
      id: 'missing-image',
      originalName: 'missing.png',
      mimeType: 'image/png',
      objectKey: 'missing-key',
      checksum: null,
    }
    await expect(loadAgentPromptImages([attachment], async () => {
      throw new Error('Blob unavailable')
    })).rejects.toThrow('Blob unavailable')
  })
})
