import { describe, expect, it } from 'vitest'
import { assistantOutputText, browserChatOutputError, generationEventHasStartedOutput, generationOutputHasStarted } from './output-text.js'

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

  it('does not treat lifecycle metadata or compaction as generated output', () => {
    expect(generationOutputHasStarted([])).toBe(false)
    expect(generationOutputHasStarted([
      { type: 'pulpo_compaction', status: 'completed', summary: 'history summary' },
      { type: 'message', role: 'assistant', status: 'in_progress', content: [] },
      { type: 'reasoning', status: 'in_progress', summary: [] },
    ])).toBe(false)
    expect(generationEventHasStartedOutput('response.created', { response: { status: 'in_progress', output: [] } })).toBe(false)
    expect(generationEventHasStartedOutput('response.failed', { response: { status: 'failed', output: [] } })).toBe(false)
  })

  it('protects substantive text, refusal, reasoning, and tool-call output', () => {
    expect(generationOutputHasStarted([
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'partial' }] },
    ])).toBe(true)
    expect(generationOutputHasStarted([
      { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No.' }] },
    ])).toBe(true)
    expect(generationOutputHasStarted([
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking' }] },
    ])).toBe(true)
    expect(generationOutputHasStarted([
      { type: 'function_call', name: 'lookup', arguments: '' },
    ])).toBe(true)
    expect(generationEventHasStartedOutput('response.refusal.delta', { delta: 'No.' })).toBe(true)
    expect(generationEventHasStartedOutput('response.output_item.added', {
      item: { type: 'function_call', name: 'lookup', arguments: '' },
    })).toBe(true)
  })
})
