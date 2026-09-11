import { describe, expect, it } from 'vitest'
import { backgroundRequestParameter, promptCacheKeyParameter, publicOutputTokenLimit, responseIncludeParameter } from './upstream-request.js'

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
