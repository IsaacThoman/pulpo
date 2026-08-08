import { describe, expect, it } from 'vitest'
import { attachmentReferenceIsLive } from './references.js'

describe('attachmentReferenceIsLive', () => {
  it('protects attachments referenced by response branches or queued messages', () => {
    const responseInput = [{ role: 'user', content: [{ type: 'input_file', attachment_id: 'response-file' }] }]
    expect(attachmentReferenceIsLive('response-file', [responseInput], [])).toBe(true)
    expect(attachmentReferenceIsLive('queue-file', [], [['queue-file']])).toBe(true)
    expect(attachmentReferenceIsLive('unused-file', [responseInput], [['queue-file']])).toBe(false)
  })
})
