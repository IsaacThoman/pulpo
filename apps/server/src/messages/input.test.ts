import { describe, expect, it } from 'vitest'
import {
  replaceResponseInputText,
  replaceResponseUserInput,
  responseAttachmentIds,
  responseInputText,
  responseUserAttachmentIds,
} from './input.js'

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

  it('extracts attachment ids from structured public API input', () => {
    expect(responseAttachmentIds([
      { role: 'user', content: [
        { type: 'input_file', attachment_id: 'owned-file' },
        { type: 'input_file', file_id: 'upstream-file' },
      ] },
    ])).toEqual(['owned-file'])
  })

  it('replaces user text without discarding attachments or other input', () => {
    const edited = replaceResponseInputText(storedInput, 'edited')

    expect(responseInputText(edited)).toBe('edited')
    expect(responseAttachmentIds(edited)).toEqual(['00000000-0000-4000-8000-000000000001'])
    expect(edited[0]).toEqual(storedInput[0])
  })

  it('replaces only the final user attachment set and preserves unknown parts', () => {
    const input = [
      { role: 'user', content: [{ type: 'input_file', attachment_id: 'older' }] },
      { role: 'developer', content: 'instructions' },
      { role: 'user', content: [
        { type: 'input_text', text: 'original' },
        { type: 'input_file', attachment_id: 'old-file' },
        { type: 'custom_part', value: true },
      ] },
    ]

    const edited = replaceResponseUserInput(input, 'edited', ['new-file'])
    expect(responseUserAttachmentIds(edited)).toEqual(['new-file'])
    expect(responseAttachmentIds(edited)).toEqual(['older', 'new-file'])
    expect(responseInputText(edited)).toBe('edited')
    expect(JSON.stringify(edited)).toContain('custom_part')
    expect(edited[0]).toEqual(input[0])
    expect(edited[1]).toEqual(input[1])
  })
})
