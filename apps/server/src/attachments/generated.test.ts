import { describe, expect, it } from 'vitest'
import { generatedAttachmentMetadata } from './generated.js'

describe('generated attachment metadata', () => {
  it('uses a safe basename and known MIME type', () => {
    expect(generatedAttachmentMetadata('/workspace/report.csv', '../final.csv', Buffer.from('a,b\n1,2'))).toEqual({
      name: 'final.csv', mimeType: 'text/csv',
    })
  })

  it('uses a binary MIME type for unknown and extensionless files', () => {
    expect(generatedAttachmentMetadata('/workspace/archive.zip', undefined, Buffer.from('zip'))).toEqual({
      name: 'archive.zip', mimeType: 'application/octet-stream',
    })
    expect(generatedAttachmentMetadata('/workspace/README', undefined, Buffer.from('hello'))).toEqual({
      name: 'README', mimeType: 'application/octet-stream',
    })
  })

  it('rejects empty files and invalid names', () => {
    expect(() => generatedAttachmentMetadata('/workspace/empty.txt', undefined, new Uint8Array())).toThrow('Empty files')
    expect(() => generatedAttachmentMetadata('/workspace/report.txt', '..', Buffer.from('hello'))).toThrow('name is invalid')
  })

  it('rejects image extensions that do not match the bytes', () => {
    expect(() => generatedAttachmentMetadata('/workspace/not-image.png', undefined, Buffer.from('hello'))).toThrow('do not match')
  })
})
