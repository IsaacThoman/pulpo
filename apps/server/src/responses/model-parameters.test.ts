import { describe, expect, it } from 'vitest'
import { resolveModelParameters } from './model-parameters.js'

describe('model request parameters', () => {
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

  it('forwards Responses API tool protocol fields independently of the model allowlist', () => {
    const tools = [{ type: 'function', name: 'bash', description: 'Run a command', parameters: { type: 'object' } }]

    expect(resolveModelParameters({
      allowedParameters: [],
      defaultParameters: {},
    }, {
      tools,
      tool_choice: 'auto',
      temperature: 0.2,
    }, { publicApi: true })).toEqual({
      tools,
      tool_choice: 'auto',
    })
  })

  it('does not let web responses bypass the model allowlist with tool protocol fields', () => {
    expect(resolveModelParameters({
      allowedParameters: [],
      defaultParameters: {},
    }, {
      tools: [{ type: 'function', name: 'bash' }],
      tool_choice: 'required',
    })).toEqual({})
  })
})
