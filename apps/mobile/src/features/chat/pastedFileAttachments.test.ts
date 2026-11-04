import { describe, expect, it } from 'vitest'
import { pastedFileAttachments } from './pastedFileAttachments'

let next = 0
const id = () => `id-${++next}`

describe('pastedFileAttachments', () => {
  it('turns pasted images and files into local composer attachments', () => {
    next = 0
    const result = pastedFileAttachments({
      failed: 0,
      files: [
        { uri: 'file:///cache/pasted-files/a/image-1.png', name: 'image-1.png', mimeType: 'image/png', size: 2048 },
        { uri: 'file:///cache/pasted-files/b/Report.pdf', name: 'Report.pdf', mimeType: 'application/pdf', size: 7138 },
      ],
    }, id)
    expect(result.error).toBeNull()
    expect(result.attachments).toEqual([
      { id: 'paste:id-1', localId: 'paste:id-1', kind: 'image', mimeType: 'image/png', name: 'image-1.png', size: 2048, uri: 'file:///cache/pasted-files/a/image-1.png', state: 'local' },
      { id: 'paste:id-2', localId: 'paste:id-2', kind: 'file', mimeType: 'application/pdf', name: 'Report.pdf', size: 7138, uri: 'file:///cache/pasted-files/b/Report.pdf', state: 'local' },
    ])
  })

  it('skips files the server would reject and reports unreadable items', () => {
    const result = pastedFileAttachments({
      failed: 2,
      files: [
        { uri: 'file:///a/empty.txt', name: 'empty.txt', mimeType: 'text/plain', size: 0 },
        { uri: 'file:///a/movie.mov', name: 'movie.mov', mimeType: 'video/quicktime', size: 50 * 1024 * 1024 },
        { uri: 'file:///a/notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 30 },
      ],
    }, id, 10 * 1024 * 1024)
    expect(result.attachments.map((attachment) => attachment.name)).toEqual(['notes.txt'])
    expect(result.error).toBe([
      'empty.txt: Attachment is empty',
      'movie.mov: Attachment exceeds the 10 MB limit',
      '2 pasted items couldn’t be read.',
    ].join('\n'))
  })
})
