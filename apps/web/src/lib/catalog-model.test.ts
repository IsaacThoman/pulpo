import { describe, expect, it } from 'vitest'
import type { Model } from '@/lib/types'
import { findCatalogModel } from './catalog-model'

const kimi: Model = {
  id: 'kimi-k3', name: 'Kimi K3', providerGroupId: 'moonshot', provider: 'Moonshot', inferenceProvider: 'Fireworks',
  labLogo: 'moonshot', modelLogo: 'moonshot', description: '', contextWindow: 262_144,
  tags: [], iconLight: '#000', iconDark: '#fff', inputPrice: 3, outputPrice: 15,
  perMessagePrice: 0, enabled: true,
  presets: [{
    id: 'speed', name: 'Speed', icon: 'zap', defaultChoiceId: 'standard',
    choices: [
      { id: 'standard', displayName: 'Standard', action: { type: 'none' } },
      { id: 'fast', displayName: 'Fast', action: { type: 'redirect', modelId: 'kimi-k3-fast' } },
    ],
  }],
}

describe('catalog model resolution', () => {
  it('maps a hidden redirect target back to its visible parent', () => {
    expect(findCatalogModel([kimi], 'kimi-k3-fast')).toBe(kimi)
  })
})
