import { describe, expect, it } from 'vitest'
import { backgroundRequestParameter, promptCacheKeyParameter, responseIncludeParameter } from './upstream-request.js'

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
