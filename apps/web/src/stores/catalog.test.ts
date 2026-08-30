import { UNKNOWN_MODEL_ID } from '@pulpo/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogModel, useCatalog } from './catalog'

describe('deleted model display', () => {
  beforeEach(() => useCatalog.setState({ models: [], loaded: true, agentAvailable: false }))

  it('uses the lowercase name and Pulpo icon for historical references', () => {
    expect(getCatalogModel(UNKNOWN_MODEL_ID)).toMatchObject({
      id: UNKNOWN_MODEL_ID,
      name: 'unknown model',
      provider: 'Pulpo',
      modelLogo: 'pulpo',
      labLogo: 'pulpo',
      enabled: false,
    })
  })

  it('uses the Pulpo icon for an unknown model ID', () => {
    expect(getCatalogModel('glm-5.3-flash')).toMatchObject({
      id: 'glm-5.3-flash',
      name: 'glm-5.3-flash',
      modelLogo: 'pulpo',
      labLogo: 'pulpo',
      enabled: false,
    })
  })
})
