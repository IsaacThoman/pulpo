import { describe, expect, it } from 'vitest'
import { assistantOutputText, browserChatOutputError } from './output-text.js'

describe('response output text', () => {
  it('extracts every visible assistant message in order', () => {
    expect(assistantOutputText([
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'First' }] },
      { type: 'pulpo_tool', output: 'hidden' },
      { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Second' }, { type: 'refusal', refusal: 'No.' }] },
      { type: 'message', content: 'Third' },
    ])).toBe('First\nSecondNo.\nThird')
  })

  it('explains a tool-only browser completion instead of accepting a blank response', () => {
    expect(browserChatOutputError([
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'I should inspect this' }] },
      { type: 'function_call', name: 'bash', arguments: '{}' },
    ])).toContain('Enable Agent mode')
  })

  it('explains other completions without visible text', () => {
    expect(browserChatOutputError([
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'No final answer' }] },
    ])).toContain('without a text response')
    expect(browserChatOutputError([
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] },
    ])).toBeUndefined()
  })
})
