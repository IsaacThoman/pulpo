import { describe, expect, it } from 'vitest'
import { estimateTokensExcludingMedia, passthroughParameters, withoutInlineMedia } from './responses-input.js'

describe('passthroughParameters', () => {
  it('keeps provider knobs, including stop sequences, and drops fields Pulpo derives itself', () => {
    expect(passthroughParameters({
      top_k: 20, repetition_penalty: 1.1, thinking: { type: 'enabled' }, undefined_value: undefined,
      max_tokens: 10, max_completion_tokens: 10, messages: [], system: 'x', stop: ['a'], stop_sequences: ['b'], tool_choice: 'auto',
      model: 'm', input: 'hi', temperature: 0.1,
    })).toEqual({ top_k: 20, repetition_penalty: 1.1, thinking: { type: 'enabled' }, stop: ['a'], stop_sequences: ['b'] })
  })
})

describe('withoutInlineMedia', () => {
  it('replaces long data URLs anywhere in the value and counts them', () => {
    const image = `data:image/png;base64,${'A'.repeat(1_000)}`
    const file = `data:application/pdf;base64,${'B'.repeat(1_000)}`
    const result = withoutInlineMedia([
      { role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: 'hi' }] },
      { type: 'file', file: { file_data: file } },
      'data:short',
      42,
      null,
    ])
    expect(result.mediaItems).toBe(2)
    expect(result.value).toEqual([
      { role: 'user', content: [{ type: 'image_url', image_url: { url: '[inline media]' } }, { type: 'text', text: 'hi' }] },
      { type: 'file', file: { file_data: '[inline media]' } },
      'data:short',
      42,
      null,
    ])
  })
})

describe('estimateTokensExcludingMedia', () => {
  it('counts text by characters and media per item', () => {
    expect(estimateTokensExcludingMedia('a'.repeat(398))).toBe(100)
    const withImage = estimateTokensExcludingMedia([{ url: `data:image/png;base64,${'A'.repeat(1_000_000)}` }])
    expect(withImage).toBeGreaterThanOrEqual(1_600)
    expect(withImage).toBeLessThan(1_620)
    expect(estimateTokensExcludingMedia(undefined)).toBe(1)
  })
})
