import { describe, expect, it } from 'vitest'
import { backgroundRequestParameter, promptCacheKeyParameter, publicOutputTokenLimit, responseIncludeParameter, strippableUpstreamParameter, upstreamErrorDetails } from './upstream-request.js'

describe('publicOutputTokenLimit', () => {
  it('preserves an admitted client limit through retries and higher-capacity fallbacks', () => {
    expect(publicOutputTokenLimit(16_384, { max_output_tokens: 37 })).toEqual({ max_output_tokens: 37 })
    expect(publicOutputTokenLimit(32_768, { max_output_tokens: 16_384 })).toEqual({ max_output_tokens: 16_384 })
  })

  it('caps an admitted limit to a smaller fallback model', () => {
    expect(publicOutputTokenLimit(2_048, { max_output_tokens: 16_384 })).toEqual({ max_output_tokens: 2_048 })
  })

  it.each([undefined, null, 0, -1, 1.5, '37'])('uses the catalog ceiling for old or malformed persisted limits: %s', (max_output_tokens) => {
    expect(publicOutputTokenLimit(16_384, { max_output_tokens })).toEqual({ max_output_tokens: 16_384 })
  })
})

describe('backgroundRequestParameter', () => {
  it('omits the background parameter for streaming execution', () => {
    expect(backgroundRequestParameter('stream')).toEqual({})
    expect(backgroundRequestParameter('stream')).not.toHaveProperty('background')
  })

  it('enables the background parameter for background execution', () => {
    expect(backgroundRequestParameter('background')).toEqual({ background: true })
  })
})

describe('responseIncludeParameter', () => {
  it('repeats normalized include values for background recovery', () => {
    expect(responseIncludeParameter({ include: ['reasoning.encrypted_content'] }))
      .toEqual({ include: ['reasoning.encrypted_content'] })
  })

  it('omits absent or malformed include values', () => {
    expect(responseIncludeParameter({})).toEqual({})
    expect(responseIncludeParameter({ include: [] })).toEqual({})
    expect(responseIncludeParameter({ include: ['reasoning.encrypted_content', 1] })).toEqual({})
  })
})

describe('promptCacheKeyParameter', () => {
  it('prefers the explicit namespaced client key over provider affinity', () => {
    expect(promptCacheKeyParameter({ prompt_cache_key: 'pulpo_pc_client' }, 'chat:generated'))
      .toEqual({ prompt_cache_key: 'pulpo_pc_client' })
  })

  it('falls back to configured provider affinity', () => {
    expect(promptCacheKeyParameter({}, 'chat:generated')).toEqual({ prompt_cache_key: 'chat:generated' })
    expect(promptCacheKeyParameter({})).toEqual({})
  })
})

describe('strippableUpstreamParameter', () => {
  const payload = { model: 'gpt-x', input: 'hi', temperature: 0.2, top_p: 0.9, reasoning: { effort: 'high' }, max_output_tokens: 100, stream: true }
  const apiError = (status: number, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { status, ...extra })

  it('names a strippable parameter from the structured param field', () => {
    expect(strippableUpstreamParameter(apiError(400, 'Unsupported parameter', { param: 'temperature', code: 'unsupported_parameter' }), payload)).toBe('temperature')
    expect(strippableUpstreamParameter(apiError(400, 'Invalid value', { param: 'reasoning.effort' }), payload)).toBe('reasoning')
  })

  it('falls back to the message when the provider omits param', () => {
    expect(strippableUpstreamParameter(apiError(400, "Unsupported parameter: 'top_p' is not supported with this model."), payload)).toBe('top_p')
    expect(strippableUpstreamParameter(apiError(400, "Unsupported value: 'temperature' does not support 0.2 with this model."), payload)).toBe('temperature')
    expect(strippableUpstreamParameter(apiError(400, 'temperature and top_p cannot both be specified'), payload)).toBeUndefined()
  })

  it('never strips billing limits, conversation fields, or parameters that are absent', () => {
    expect(strippableUpstreamParameter(apiError(400, 'bad', { param: 'max_output_tokens' }), payload)).toBeUndefined()
    expect(strippableUpstreamParameter(apiError(400, 'bad', { param: 'input' }), payload)).toBeUndefined()
    expect(strippableUpstreamParameter(apiError(400, 'bad', { param: 'tools' }), payload)).toBeUndefined()
    expect(strippableUpstreamParameter(apiError(400, 'bad', { param: 'service_tier' }), payload)).toBeUndefined()
  })

  it('only reacts to 400 responses', () => {
    expect(strippableUpstreamParameter(apiError(500, 'bad', { param: 'temperature' }), payload)).toBeUndefined()
    expect(strippableUpstreamParameter(new Error("Unsupported parameter: 'temperature'"), payload)).toBeUndefined()
  })
})

describe('upstreamErrorDetails', () => {
  it('reads SDK error fields and nested provider bodies', () => {
    const sdkError = Object.assign(new Error('400 Unsupported parameter'), {
      status: 400, code: 'unsupported_parameter', param: 'top_p', type: 'invalid_request_error',
      error: { message: "Unsupported parameter: 'top_p'", type: 'invalid_request_error', code: 'unsupported_parameter', param: 'top_p' },
    })
    expect(upstreamErrorDetails(sdkError)).toEqual({
      status: 400, code: 'unsupported_parameter', param: 'top_p', type: 'invalid_request_error', message: "Unsupported parameter: 'top_p'",
    })
    expect(upstreamErrorDetails(new Error('plain'))).toEqual({ status: undefined, code: undefined, param: undefined, type: undefined, message: 'plain' })
  })
})
