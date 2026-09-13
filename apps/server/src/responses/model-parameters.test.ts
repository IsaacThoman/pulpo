import { describe, expect, it } from 'vitest'
import { resolveModelParameters, unsupportedPublicModelParameter } from './model-parameters.js'

describe('model request parameters', () => {
  it('identifies the exact unsupported public parameter before queueing', () => {
    expect(unsupportedPublicModelParameter(
      { allowedParameters: ['temperature'] },
      { instructions: 'safe protocol field', include: ['reasoning.encrypted_content'], temperature: 0.2, service_tier: 'priority' },
    )).toBe('service_tier')
    expect(unsupportedPublicModelParameter(
      { allowedParameters: ['temperature', 'tools'] },
      { instructions: 'safe protocol field', temperature: 0.2, tools: [] },
    )).toBeUndefined()
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

    expect(unsupportedPublicModelParameter({ allowedParameters: [] }, parameters)).toBeUndefined()

    expect(resolveModelParameters({
      allowedParameters: [],
      defaultParameters: {},
    }, {
      ...parameters,
      temperature: 0.2,
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

    expect(unsupportedPublicModelParameter({ allowedParameters: [] }, parameters)).toBe('top_logprobs')
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
