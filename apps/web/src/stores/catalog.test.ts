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
})
