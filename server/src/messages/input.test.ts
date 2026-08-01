import { describe, expect, it } from 'vitest'
import { replaceResponseInputText, responseAttachmentIds, responseInputText } from './input.js'

const storedInput = [
  { role: 'developer', content: 'instructions' },
  { role: 'user', content: [
    { type: 'input_text', text: 'original' },
    { type: 'input_file', attachment_id: '00000000-0000-4000-8000-000000000001' },
  ] },
]

describe('stored message input', () => {
  it('extracts user text and attachment ids', () => {
    expect(responseInputText(storedInput)).toBe('original')
    expect(responseAttachmentIds(storedInput)).toEqual(['00000000-0000-4000-8000-000000000001'])
  })

  it('replaces user text without discarding attachments or other input', () => {
    const edited = replaceResponseInputText(storedInput, 'edited')

    expect(responseInputText(edited)).toBe('edited')
    expect(responseAttachmentIds(edited)).toEqual(['00000000-0000-4000-8000-000000000001'])
    expect(edited[0]).toEqual(storedInput[0])
  })
})
