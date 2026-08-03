import { describe, expect, it } from 'vitest'
import { generatedAttachmentMetadata } from './generated.js'

describe('generated attachment metadata', () => {
  it('uses a safe basename and known MIME type', () => {
    expect(generatedAttachmentMetadata('/workspace/report.csv', '../final.csv', Buffer.from('a,b\n1,2'))).toEqual({
      name: 'final.csv', mimeType: 'text/csv',
    })
  })

  it('rejects empty and unsupported files', () => {
    expect(() => generatedAttachmentMetadata('/workspace/empty.txt', undefined, new Uint8Array())).toThrow('Empty files')
    expect(() => generatedAttachmentMetadata('/workspace/archive.zip', undefined, Buffer.from('zip'))).toThrow('cannot be attached')
  })

  it('rejects image extensions that do not match the bytes', () => {
    expect(() => generatedAttachmentMetadata('/workspace/not-image.png', undefined, Buffer.from('hello'))).toThrow('do not match')
  })
})
