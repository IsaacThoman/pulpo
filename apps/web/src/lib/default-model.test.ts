import { describe, expect, it } from 'vitest'
import type { Model } from '@/lib/types'
import { resolveDefaultModelId } from './default-model'

function model(id: string, enabled = true): Model {
  return {
    id,
    name: id,
    provider: 'OpenAI',
    inferenceProvider: 'OpenAI',
    labLogo: 'openai',
    modelLogo: 'openai',
    description: '',
    contextWindow: 1,
    tags: [],
    iconLight: '#000000',
    iconDark: '#ffffff',
    inputPrice: 0,
    outputPrice: 0,
    perMessagePrice: 0,
    enabled,
    agentEnabled: false,
    presets: [],
  }
}

describe('resolveDefaultModelId', () => {
  it('uses an enabled account default', () => {
    expect(resolveDefaultModelId([model('first'), model('saved')], 'saved')).toBe('saved')
  })

  it('falls back to the first enabled model when the saved model is unavailable', () => {
    expect(resolveDefaultModelId([model('disabled', false), model('enabled')], 'missing')).toBe('enabled')
    expect(resolveDefaultModelId([model('saved', false), model('enabled')], 'saved')).toBe('enabled')
  })

  it('supports an empty catalog', () => {
    expect(resolveDefaultModelId([], 'saved')).toBe('')
  })
})
