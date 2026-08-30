import { describe, expect, it } from 'vitest'
import { importedModelIdentity, responseDisplayModelId } from './modelIdentity.js'

describe('importedModelIdentity', () => {
  it('keeps enabled source models unchanged', () => {
    expect(importedModelIdentity('active-model', new Set(['active-model'])))
      .toEqual({ modelId: 'active-model', metadata: {} })
  })

  it('stores unavailable models as unknown while retaining their raw ID', () => {
    expect(importedModelIdentity('retired-model', new Set()))
      .toEqual({
        modelId: 'pulpo-unknown-model',
        metadata: { importedModelId: 'retired-model' },
      })
  })
})

describe('responseDisplayModelId', () => {
  it('uses the model that actually produced a forwarded response', () => {
    expect(responseDisplayModelId({ modelId: 'requested-model', actualModelId: 'forwarded-model' }))
      .toBe('forwarded-model')
  })

  it('falls back to the stored model for responses without execution metadata', () => {
    expect(responseDisplayModelId({ modelId: 'legacy-model', actualModelId: null }))
      .toBe('legacy-model')
  })

  it('shows the source model name for imports stored against the unknown model', () => {
    expect(responseDisplayModelId({
      modelId: 'pulpo-unknown-model',
      actualModelId: 'pulpo-unknown-model',
      metadata: { importedModelId: 'retired-model' },
    })).toBe('retired-model')
  })
})
