import { describe, expect, it } from 'vitest'
import { chatPresetsSchema, responseEventSchema, syncRequestSchema } from './index.js'

describe('shared contracts', () => {
  it('rejects response events without a positive sequence', () => {
    const result = responseEventSchema.safeParse({
      responseId: crypto.randomUUID(),
      sequence: 0,
      type: 'response.created',
      payload: {},
      emittedAt: new Date().toISOString(),
    })
    expect(result.success).toBe(false)
  })

  it('accepts per-response synchronization cursors', () => {
    const responseId = crypto.randomUUID()
    const result = syncRequestSchema.parse({
      tabId: 'tab-1',
      accountRevision: 3,
      responseCursors: { [responseId]: 42 },
    })
    expect(result.responseCursors[responseId]).toBe(42)
  })

  it('accepts generic composer presets', () => {
    const presets = chatPresetsSchema.parse([{
      id: 'reasoning', name: 'Reasoning', icon: 'brain', defaultChoiceId: 'medium',
      choices: [
        { id: 'off', displayName: 'Off', action: { type: 'none' } },
        { id: 'medium', displayName: 'Medium', icon: 'sparkles', action: { type: 'params', params: { reasoning_effort: 'medium' } } },
      ],
    }])
    expect(presets[0]?.defaultChoiceId).toBe('medium')
  })

  it.each([
    { name: 'malformed IDs', value: [{ id: 'Not Valid', name: 'Reasoning', icon: 'brain', choices: [{ id: 'on', displayName: 'On', action: { type: 'none' } }] }] },
    { name: 'empty choices', value: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', choices: [] }] },
    { name: 'invalid defaults', value: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', defaultChoiceId: 'missing', choices: [{ id: 'on', displayName: 'On', action: { type: 'none' } }] }] },
    { name: 'unsupported actions', value: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', choices: [{ id: 'on', displayName: 'On', action: { type: 'script' } }] }] },
    { name: 'duplicate preset IDs', value: [
      { id: 'style', name: 'Style', icon: 'sparkles', choices: [{ id: 'a', displayName: 'A', action: { type: 'none' } }] },
      { id: 'style', name: 'Style again', icon: 'sparkles', choices: [{ id: 'b', displayName: 'B', action: { type: 'none' } }] },
    ] },
    { name: 'too many choices', value: [{ id: 'style', name: 'Style', icon: 'sparkles', choices: Array.from({ length: 21 }, (_, index) => ({ id: `choice-${index}`, displayName: `Choice ${index}`, action: { type: 'none' } })) }] },
  ])('rejects $name', ({ value }) => {
    expect(chatPresetsSchema.safeParse(value).success).toBe(false)
  })
})
