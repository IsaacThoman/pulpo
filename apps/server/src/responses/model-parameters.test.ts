import { describe, expect, it } from 'vitest'
import { droppedPublicModelParameters, resolveModelParameters } from './model-parameters.js'

describe('model request parameters', () => {
  it('lists the admin-gated public parameters to drop before queueing', () => {
    expect(droppedPublicModelParameters(
      { allowedParameters: ['temperature'] },
      { instructions: 'safe protocol field', include: ['reasoning.encrypted_content'], temperature: 0.2, service_tier: 'priority', top_logprobs: 3 },
    )).toEqual(['service_tier', 'top_logprobs'])
    expect(droppedPublicModelParameters(
      { allowedParameters: ['tools'] },
      { instructions: 'safe protocol field', temperature: 0.2, tools: [] },
    )).toEqual([])
  })

  it('always forwards per-token sampling and output-shape knobs for public requests', () => {
    // Clients such as OpenCode send these by default; they bill per token like any request.
    const parameters = { temperature: 0.3, top_p: 0.9, reasoning: { effort: 'high' }, text: { format: { type: 'text' } } }
    expect(droppedPublicModelParameters({ allowedParameters: [] }, parameters)).toEqual([])
    expect(resolveModelParameters({ allowedParameters: [], defaultParameters: {} }, parameters, { publicApi: true })).toEqual(parameters)
    // Admin-gated behavior falls back to the model default instead of failing.
    expect(resolveModelParameters(
      { allowedParameters: [], defaultParameters: { service_tier: 'flex' } },
      { ...parameters, service_tier: 'priority' },
      { publicApi: true },
    )).toEqual(parameters)
    // Web chat keeps the allowlist boundary for the same knobs.
    expect(resolveModelParameters({ allowedParameters: [], defaultParameters: {} }, parameters)).toEqual({})
  })

  it('applies allowed response parameters over model defaults', () => {
    expect(resolveModelParameters({
      allowedParameters: ['reasoning', 'service_tier', 'temperature'],
      defaultParameters: { service_tier: 'flex', temperature: 0.5, ignored: true },
    }, {
      reasoning: { effort: 'high', summary: 'auto' },
      temperature: 0.2,
      ignored: false,
    })).toEqual({
      service_tier: 'flex',
      temperature: 0.2,
      reasoning: { effort: 'high', summary: 'auto' },
    })
  })

  it('re-resolves defaults for a fallback while preserving allowed selections', () => {
    const responseParameters = { reasoning: { effort: 'xhigh' } }
    const primary = resolveModelParameters({
      allowedParameters: ['reasoning', 'service_tier'],
      defaultParameters: { service_tier: 'flex' },
    }, responseParameters)
    const fallback = resolveModelParameters({
      allowedParameters: ['reasoning', 'service_tier'],
      defaultParameters: { service_tier: 'default' },
    }, responseParameters)

    expect(primary).toEqual({ service_tier: 'flex', reasoning: { effort: 'xhigh' } })
    expect(fallback).toEqual({ service_tier: 'default', reasoning: { effort: 'xhigh' } })
  })

  it('never forwards reserved request fields', () => {
    expect(resolveModelParameters({
      allowedParameters: ['model', 'input', 'stream', 'store', 'metadata', 'service_tier'],
      defaultParameters: { model: 'wrong', service_tier: 'flex' },
    }, { input: 'wrong', stream: false, store: true, metadata: { wrong: true } })).toEqual({
      service_tier: 'flex',
    })
  })

  it('accepts and forwards public tool protocol fields with an empty model allowlist', () => {
    const tools = [{ type: 'function', name: 'bash', description: 'Run a command', parameters: { type: 'object' } }]
    const parameters = { tools, tool_choice: 'auto', parallel_tool_calls: false }

    expect(droppedPublicModelParameters({ allowedParameters: [] }, parameters)).toEqual([])

    expect(resolveModelParameters({
      allowedParameters: [],
      defaultParameters: {},
    }, {
      ...parameters,
      service_tier: 'priority',
    }, { publicApi: true })).toEqual(parameters)
  })

  it('preserves client tools and choices when resolving a fallback model', () => {
    const parameters = {
      tools: [{ type: 'function', name: 'read', parameters: { type: 'object' }, strict: false }],
      tool_choice: { type: 'function', name: 'read' },
      parallel_tool_calls: true,
    }
    for (const allowedParameters of [[], ['reasoning'], ['tools', 'tool_choice']]) {
      expect(resolveModelParameters({ allowedParameters, defaultParameters: {} }, parameters, { publicApi: true }))
        .toEqual(parameters)
    }
  })

  it('forwards public protocol fields while keeping model behavior allowlisted', () => {
    const parameters = {
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: 'opaque-cache-key',
      safety_identifier: 'opaque-safety-id',
      stream_options: { include_obfuscation: false },
      top_logprobs: 5,
      truncation: 'auto',
    }

    expect(droppedPublicModelParameters({ allowedParameters: [] }, parameters)).toEqual(['top_logprobs', 'truncation'])
    expect(resolveModelParameters({
      allowedParameters: ['top_logprobs', 'truncation'],
      defaultParameters: {},
    }, parameters, { publicApi: true })).toEqual(parameters)
  })

  it('does not let web responses bypass the model allowlist with tool protocol fields', () => {
    expect(resolveModelParameters({
      allowedParameters: [],
      defaultParameters: {},
    }, {
      tools: [{ type: 'function', name: 'bash' }],
      tool_choice: 'required',
      parallel_tool_calls: true,
    })).toEqual({})
  })
})
