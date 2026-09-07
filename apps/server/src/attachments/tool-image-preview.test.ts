import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  put: vi.fn(), deleteBlob: vi.fn(), reserve: vi.fn(),
}))
vi.mock('../database/client.js', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows }) }) }),
  update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { Object.assign(mocks.rows[0]!, values) } }) }),
  delete: () => ({ where: async () => { mocks.rows = [] } }),
} }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ put: mocks.put, delete: mocks.deleteBlob }) }))
vi.mock('./storage-quota.js', () => ({ reserveAttachment: mocks.reserve }))
import { storeToolImagePreview } from './tool-image-preview.js'

const input = { responseId: 'response-1', toolCallId: 'call-1', userId: 'user-1', chatId: 'chat-1', path: '/tmp/chart.png' }
beforeEach(() => {
  mocks.rows = []
  mocks.put.mockReset().mockResolvedValue(undefined)
  mocks.deleteBlob.mockReset().mockResolvedValue(undefined)
  mocks.reserve.mockReset().mockImplementation(async (values: Record<string, unknown>) => {
    const row = { ...values, status: 'pending' }
    mocks.rows.push(row)
    return row
  })
})

describe('tool image preview storage', () => {
  it.each(['png', 'jpeg', 'gif', 'webp'] as const)('stores only a bounded WebP thumbnail of %s input and reuses it on retry', async (format) => {
    const image = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#00aabb' } }).toFormat(format).toBuffer()
    const preview = await storeToolImagePreview({ ...input, data: image.toString('base64') })
    const bytes = mocks.put.mock.calls[0]![1] as Buffer
    expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 512, height: 341 })
    expect(bytes.equals(image)).toBe(false)
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'tool_preview', sourceResponseId: input.responseId, sourceToolCallId: input.toolCallId,
      userId: input.userId, chatId: input.chatId, sizeBytes: bytes.length,
    }))
    expect(preview).toMatchObject({ name: 'chart.png.webp', mimeType: 'image/webp', sizeBytes: bytes.length })
    expect(mocks.rows[0]?.status).toBe('ready')
    expect(await storeToolImagePreview({ ...input, data: image.toString('base64') })).toEqual(preview)
    expect(mocks.put).toHaveBeenCalledTimes(1)
    expect(mocks.reserve).toHaveBeenCalledTimes(1)
  })

  it('rotates EXIF orientation and accepts extensionless image paths', async () => {
    const image = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#00aabb' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const preview = await storeToolImagePreview({ ...input, path: '/tmp/image', data: image.toString('base64') })
    expect(preview.name).toBe('image.webp')
    expect(await sharp(mocks.put.mock.calls[0]![1] as Buffer).metadata()).toMatchObject({ width: 40, height: 80 })
  })

  it('cleans up a failed upload and allows a later retry', async () => {
    const image = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#00aabb' } }).png().toBuffer()
    mocks.put.mockRejectedValueOnce(new Error('Storage unavailable'))
    await expect(storeToolImagePreview({ ...input, data: image.toString('base64') })).rejects.toThrow('Storage unavailable')
    expect(mocks.rows[0]?.status).toBe('failed')
    expect(mocks.deleteBlob).toHaveBeenCalledTimes(1)
    await expect(storeToolImagePreview({ ...input, data: image.toString('base64') })).resolves.toMatchObject({ mimeType: 'image/webp' })
    expect(mocks.rows[0]?.status).toBe('ready')
  })

  it('does not store malformed images or bypass quota rejection', async () => {
    await expect(storeToolImagePreview({ ...input, data: Buffer.from('not an image').toString('base64') })).rejects.toThrow()
    expect(mocks.reserve).not.toHaveBeenCalled()
    const image = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#00aabb' } }).png().toBuffer()
    mocks.reserve.mockRejectedValueOnce(new Error('Quota exceeded'))
    await expect(storeToolImagePreview({ ...input, data: image.toString('base64') })).rejects.toThrow('Quota exceeded')
    expect(mocks.put).not.toHaveBeenCalled()
  })
})
