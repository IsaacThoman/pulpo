import { describe, expect, it } from 'vitest'
import { resolveModelParameters, unsupportedPublicModelParameter } from '../responses/model-parameters.js'
import { parseChatCompletionRequest, parseResponsesRequest } from './codecs.js'

const model = { allowedParameters: [], defaultParameters: {} }
const parameters = {
  type: 'object',
  properties: { filePath: { type: 'string' } },
  required: ['filePath'],
  additionalProperties: false,
}
const fn = { name: 'read', description: 'Read a file', parameters, strict: false }
const tool = { type: 'function', ...fn }
const args = JSON.stringify({ filePath: '/project/probe.txt' })

describe('external client tool compatibility', () => {
  it('accepts the OpenCode Chat Completions request shape without catalog tool configuration', () => {
    // Reduced from OpenCode 1.18.30 using @ai-sdk/openai-compatible.
    const request = parseChatCompletionRequest({
      model: 'model-1',
      messages: [
        { role: 'system', content: 'You are a coding assistant.' },
        { role: 'user', content: [{ type: 'text', text: 'Read probe.txt' }] },
      ],
      max_tokens: 16_384,
      tools: [{ type: 'function', function: fn }],
      tool_choice: 'auto',
      stream: true,
      stream_options: { include_usage: true },
    })

    expect(unsupportedPublicModelParameter(model, request.parameters)).toBeUndefined()
    expect(resolveModelParameters(model, request.parameters, { publicApi: true }))
      .toEqual({ tools: [tool], tool_choice: 'auto' })
    expect(request.streamIncludeUsage).toBe(true)
    expect(request.maxOutputTokens).toBe(16_384)
    expect(request.ignoredParameters).toEqual([])
  })

  it.each(['chat_completions', 'responses'])('preserves %s tool results and named choices through worker parameter resolution', (protocol) => {
    const request = protocol === 'chat_completions'
      ? parseChatCompletionRequest({
        model: 'model-1',
        messages: [
          { role: 'user', content: 'Read probe.txt' },
          { role: 'assistant', content: null, tool_calls: [{ id: 'call_read', type: 'function', function: { name: 'read', arguments: args } }] },
          { role: 'tool', tool_call_id: 'call_read', content: 'PULPO_COMPAT_598' },
        ],
        tools: [{ type: 'function', function: fn }],
        tool_choice: { type: 'function', function: { name: 'read' } },
        parallel_tool_calls: false,
      })
      : parseResponsesRequest({
        model: 'model-1',
        input: [
          { role: 'user', content: 'Read probe.txt' },
          { type: 'function_call', call_id: 'call_read', name: 'read', arguments: args },
          { type: 'function_call_output', call_id: 'call_read', output: 'PULPO_COMPAT_598' },
        ],
        tools: [tool],
        tool_choice: { type: 'function', name: 'read' },
        parallel_tool_calls: false,
      })

    expect(unsupportedPublicModelParameter(model, request.parameters)).toBeUndefined()
    expect(resolveModelParameters(model, request.parameters, { publicApi: true })).toEqual({
      tools: [tool], tool_choice: { type: 'function', name: 'read' }, parallel_tool_calls: false,
    })
    expect(request.rawInput).toEqual([
      { role: 'user', content: 'Read probe.txt' },
      { type: 'function_call', call_id: 'call_read', name: 'read', arguments: args },
      { type: 'function_call_output', call_id: 'call_read', output: 'PULPO_COMPAT_598' },
    ])
  })
})
