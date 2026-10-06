import { describe, expect, it } from 'vitest'
import { ResponsesStreamBuilder, responsesUsage, type ResponsesStreamEvent } from './responses-builder.js'

function types(events: ResponsesStreamEvent[]): string[] {
  return events.map((event) => event.type)
}

function builder(format: 'openai_chat_completions' | 'anthropic_messages' = 'anthropic_messages') {
  return new ResponsesStreamBuilder(format, { id: 'resp_1', model: 'pulpo-model' }, 'upstream-model')
}

describe('responsesUsage', () => {
  it('clamps negatives, totals input and output, and keeps only finite non-negative cost', () => {
    expect(responsesUsage({ inputTokens: 10, cachedInputTokens: 4, cacheWriteTokens: 2, outputTokens: 5, reasoningTokens: 3, cost: 0.01 })).toEqual({
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 3 },
      total_tokens: 15,
      cost: 0.01,
    })
    const clamped = responsesUsage({ inputTokens: -1, outputTokens: -2, cost: Number.NaN })
    expect(clamped).toMatchObject({ input_tokens: 0, output_tokens: 0, total_tokens: 0 })
    expect(clamped).not.toHaveProperty('cost')
    expect(responsesUsage({ inputTokens: 1, outputTokens: 1, cost: -1 })).not.toHaveProperty('cost')
  })
})

describe('ResponsesStreamBuilder', () => {
  it('starts once, adopting the upstream identity', () => {
    const b = builder()
    const started = b.start({ id: 'msg_upstream', model: 'claude-x' })
    expect(types(started)).toEqual(['response.created', 'response.in_progress'])
    expect(started[0]!.response).toMatchObject({ id: 'msg_upstream', model: 'claude-x', status: 'in_progress', output: [] })
    expect(b.id).toBe('msg_upstream')
    expect(b.start({ id: 'other' })).toEqual([])
    expect(b.id).toBe('msg_upstream')
  })

  it('implicitly starts on first content and streams text with a single content part', () => {
    const b = builder()
    const events = [...b.text('Hel'), ...b.text(''), ...b.text('lo')]
    expect(types(events)).toEqual([
      'response.created', 'response.in_progress', 'response.output_item.added', 'response.content_part.added',
      'response.output_text.delta', 'response.output_text.delta',
    ])
    expect(events[2]).toMatchObject({ output_index: 0, item: { type: 'message', role: 'assistant', status: 'in_progress', content: [] } })
    expect(events[3]).toMatchObject({ content_index: 0, part: { type: 'output_text', text: '' } })
    const { events: done, result } = b.finish({ usage: null })
    expect(types(done)).toEqual(['response.output_text.done', 'response.content_part.done', 'response.output_item.done', 'response.completed'])
    expect(done[0]).toMatchObject({ text: 'Hello' })
    expect(done[2]).toMatchObject({ item: { status: 'completed', content: [{ type: 'output_text', text: 'Hello', annotations: [] }] } })
    expect(result).toMatchObject({ status: 'completed', output_text: 'Hello', incomplete_details: null, error: null })
    const all = [...events, ...done]
    expect(all.map((event) => event.sequence_number)).toEqual(all.map((_, index) => index))
    expect(b.isFinished).toBe(true)
  })

  it('streams refusals after text at content index 1', () => {
    const b = builder()
    b.text('partial')
    const refusal = b.refusal('no')
    expect(types(refusal)).toEqual(['response.content_part.added', 'response.refusal.delta'])
    expect(refusal[0]).toMatchObject({ content_index: 1, part: { type: 'refusal', refusal: '' } })
    expect(refusal[1]).toMatchObject({ content_index: 1, delta: 'no' })
    const { events, result } = b.finish({ usage: null })
    expect(types(events)).toEqual([
      'response.output_text.done', 'response.content_part.done', 'response.refusal.done', 'response.content_part.done',
      'response.output_item.done', 'response.completed',
    ])
    expect(events[2]).toMatchObject({ content_index: 1, refusal: 'no' })
    expect(result.output).toEqual([{
      id: expect.any(String), type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'partial', annotations: [] }, { type: 'refusal', refusal: 'no' }],
    }])
  })

  // BUG: when a refusal streams before text, deltas use refusal=0/text=1 but the
  // done events and final item always order text=0/refusal=1.
  it('keeps content indexes consistent when a refusal precedes text', () => {
    const b = builder()
    const streamed = [...b.refusal('no'), ...b.text('but')]
    const { events } = b.finish({ usage: null })
    const deltaIndex = streamed.find((event) => event.type === 'response.output_text.delta')!.content_index
    const doneIndex = events.find((event) => event.type === 'response.output_text.done')!.content_index
    expect(doneIndex).toBe(deltaIndex)
  })

  it('closes the open message when reasoning starts and opens a new message afterwards', () => {
    const b = builder()
    b.text('before')
    const reasoning = b.reasoning('r1', 'thinking')
    expect(types(reasoning)).toEqual([
      'response.output_text.done', 'response.content_part.done', 'response.output_item.done',
      'response.output_item.added', 'response.reasoning_summary_part.added', 'response.reasoning_summary_text.delta',
    ])
    expect(reasoning[3]).toMatchObject({ output_index: 1, item: { type: 'reasoning', summary: [] } })
    b.reasoningSignature('r1', 'sig-')
    b.reasoningSignature('r1', 'part2')
    b.reasoningSignature('missing', 'ignored')
    const done = b.reasoningDone('r1')
    expect(types(done)).toEqual(['response.reasoning_summary_text.done', 'response.reasoning_summary_part.done', 'response.output_item.done'])
    expect(done[2]!.item).toEqual({
      id: expect.stringMatching(/^rs_pulpo_/), type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking' }],
      pulpo_format: 'anthropic_messages', pulpo_model: 'upstream-model', pulpo_signature: 'sig-part2',
    })
    expect(b.reasoningDone('r1')).toEqual([])
    expect(b.reasoning('r1', 'late')).toEqual([])
    const after = b.text('after')
    expect(after[0]).toMatchObject({ type: 'response.output_item.added', output_index: 2, item: { type: 'message' } })
    const { result } = b.finish({ usage: null })
    expect(result.output.map((item) => item.type)).toEqual(['message', 'reasoning', 'message'])
    expect(result.output_text).toBe('beforeafter')
    expect(result.output[0]!.id).not.toBe(result.output[2]!.id)
  })

  it('emits redacted and empty reasoning items without summary parts', () => {
    const b = builder()
    const started = b.reasoningStart('omitted')
    expect(types(started)).toEqual(['response.created', 'response.in_progress', 'response.output_item.added'])
    expect(b.reasoningStart('omitted')).toEqual([])
    expect(b.hasReasoning('omitted')).toBe(true)
    expect(types(b.reasoningDone('omitted'))).toEqual(['response.output_item.done'])
    b.redactedReasoning('redacted', 'opaque')
    const done = b.reasoningDone('redacted')
    expect(done[0]!.item).toMatchObject({ type: 'reasoning', summary: [], pulpo_redacted_data: 'opaque', pulpo_format: 'anthropic_messages' })
    expect(done[0]!.item).not.toHaveProperty('pulpo_signature')
  })

  it('defaults pulpo_model to the initial model', () => {
    const b = new ResponsesStreamBuilder('openai_chat_completions', { model: 'gpt-x' })
    expect(b.id).toMatch(/^resp_pulpo_/)
    b.reasoning('r', 'x')
    expect(b.finish({ usage: null }).result.output[0]).toMatchObject({ pulpo_format: 'openai_chat_completions', pulpo_model: 'gpt-x' })
  })

  it('builds function calls, merging late identity and defaulting empty arguments to {}', () => {
    const b = builder()
    b.text('calling')
    const added = b.functionCall('0', { name: 'lookup' })
    expect(types(added)).toEqual(['response.output_text.done', 'response.content_part.done', 'response.output_item.done', 'response.output_item.added'])
    expect(added[3]!.item).toMatchObject({ type: 'function_call', status: 'in_progress', name: 'lookup', call_id: expect.stringMatching(/^call_/), arguments: '' })
    expect(b.functionCall('0', { callId: 'ignored-later', name: 'other' })).toEqual([])
    expect(types(b.functionArguments('0', '{"q":'))).toEqual(['response.function_call_arguments.delta'])
    b.functionArguments('0', '1}')
    expect(b.functionArguments('0', '')).toEqual([])
    const empty = b.functionCall('1', { callId: 'call_b', name: 'noop' })
    expect(empty).toHaveLength(1)
    const done = b.functionDone('1')
    expect(done[0]).toMatchObject({ type: 'response.function_call_arguments.done', name: 'noop', arguments: '{}' })
    expect(done[1]!.item).toEqual({ id: expect.any(String), type: 'function_call', status: 'completed', call_id: 'call_b', name: 'noop', arguments: '{}' })
    expect(b.functionDone('1')).toEqual([])
    expect(b.functionDone('unknown')).toEqual([])
    const { events, result } = b.finish({ usage: null })
    expect(types(events)).toEqual(['response.function_call_arguments.done', 'response.output_item.done', 'response.completed'])
    expect(result.output.slice(1)).toMatchObject([
      { type: 'function_call', name: 'lookup', arguments: '{"q":1}' },
      { type: 'function_call', call_id: 'call_b', arguments: '{}' },
    ])
  })

  it('creates a function call from an argument delta alone', () => {
    const b = builder()
    const events = b.functionArguments('k', '{}')
    expect(types(events)).toEqual(['response.created', 'response.in_progress', 'response.output_item.added', 'response.function_call_arguments.delta'])
  })

  it('finishes incomplete with usage and filters empty messages from output', () => {
    const b = builder()
    const usage = responsesUsage({ inputTokens: 3, outputTokens: 4 })
    const { events, result } = b.finish({ usage, incompleteReason: 'max_output_tokens' })
    expect(types(events)).toEqual(['response.created', 'response.in_progress', 'response.incomplete'])
    expect(result).toMatchObject({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage, output: [], output_text: '' })
    expect(events.at(-1)!.response).toBe(result)
  })

  it('reports in-progress items in output() before finishing', () => {
    const b = builder()
    b.text('a')
    b.functionCall('f', { callId: 'c', name: 'n' })
    expect(b.output().map((item) => item.status)).toEqual(['completed', 'in_progress'])
    expect(b.outputText()).toBe('a')
  })

  it('reports progress with usage and partial output without finishing', () => {
    const fresh = builder()
    const usage = responsesUsage({ inputTokens: 7, outputTokens: 2 })
    const initial = fresh.progress(usage)
    expect(types(initial)).toEqual(['response.created', 'response.in_progress', 'response.in_progress'])
    expect(initial.at(-1)!.response).toMatchObject({ status: 'in_progress', usage, output: [] })

    const b = builder()
    const events = [...b.text('Hi'), ...b.progress(null)]
    expect(events.at(-1)).toMatchObject({ type: 'response.in_progress', response: { status: 'in_progress', output_text: 'Hi', usage: null } })
    expect((events.at(-1)!.response as { output: unknown[] }).output).toHaveLength(1)
    expect(b.isFinished).toBe(false)
    expect(events.map((event) => event.sequence_number)).toEqual(events.map((_, index) => index))
  })

  it('estimates output tokens from generated text, reasoning, refusals, and calls', () => {
    const b = builder()
    expect(b.estimatedOutputTokens()).toBe(0)
    b.reasoning('r', 'abcd')
    b.text('efgh')
    b.refusal('ij')
    b.functionCall('f', { callId: 'c', name: 'fn' })
    b.functionArguments('f', '{}')
    // 4 + 4 + 2 + 2 + 2 = 14 characters -> ceil(14 / 4)
    expect(b.estimatedOutputTokens()).toBe(4)
  })
})
