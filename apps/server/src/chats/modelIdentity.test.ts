import { describe, expect, it } from 'vitest'
import { responseDisplayModelId } from './modelIdentity.js'

describe('responseDisplayModelId', () => {
  it('uses the model that actually produced a forwarded response', () => {
    expect(responseDisplayModelId({ modelId: 'requested-model', actualModelId: 'forwarded-model' }))
      .toBe('forwarded-model')
  })

  it('falls back to the stored model for responses without execution metadata', () => {
    expect(responseDisplayModelId({ modelId: 'legacy-model', actualModelId: null }))
      .toBe('legacy-model')
  })
})
