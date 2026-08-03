import { describe, expect, it } from 'vitest'
import { detectImageMime } from './images.js'

describe('agent image detection', () => {
  it.each([
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    [Buffer.from('GIF89a', 'ascii'), 'image/gif'],
    [Buffer.from('RIFF0000WEBP', 'ascii'), 'image/webp'],
  ])('recognizes supported image bytes', (bytes, expected) => {
    expect(detectImageMime(bytes)).toBe(expected)
  })

  it('rejects extensions and declared types without a supported signature', () => {
    expect(detectImageMime(Buffer.from('not really an image'))).toBeNull()
  })
})
