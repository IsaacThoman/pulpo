import { describe, expect, it } from 'vitest'
import { canonicalUsageModels, decodeUsageCursor, encodeUsageCursor, publicModel, resolveUsageModelAlias } from './public.js'

describe('friends leaderboard usage', () => {
  it('round trips stable timestamp and id cursors', () => {
    const cursor = { createdAt: new Date('2026-08-01T12:00:00.000Z'), id: '00000000-0000-4000-8000-000000000001' }
    expect(decodeUsageCursor(encodeUsageCursor(cursor))).toEqual(cursor)
  })

  it('rejects malformed cursors', () => {
    expect(() => decodeUsageCursor('not-a-cursor')).toThrow('usage cursor is invalid')
  })

  it('hides private model metadata', () => {
    expect(publicModel({ visible: false, id: 'secret-model', name: 'Secret', logo: 'secret' }))
      .toEqual({ id: 'other', name: 'Other', logo: null })
  })

  it('combines duplicate display names into their most-used model', () => {
    const canonical = canonicalUsageModels([
      { modelId: 'kimi-fast', modelName: 'Kimi K3', modelLogo: null, modelVisible: false, calls: 10, costMicros: 196_700 },
      { modelId: 'kimi', modelName: ' KIMI K3 ', modelLogo: 'kimi', modelVisible: true, calls: 27, costMicros: 502_800 },
    ])
    expect(canonical.get('kimi-fast')?.modelId).toBe('kimi')
    expect(canonical.get('kimi')?.modelId).toBe('kimi')
  })

  it('attributes a hidden redirect target to its visible preset owner', () => {
    const usage = { modelId: 'kimi-fast', modelName: 'Kimi K3 Fast', modelLogo: null, modelVisible: false, calls: 1, costMicros: 20_100 }
    const owner = { modelId: 'kimi', modelName: 'Kimi K3', modelLogo: 'kimi', modelVisible: true, calls: 0, costMicros: 0 }
    expect(resolveUsageModelAlias(usage, new Map([['kimi-fast', owner]]))).toEqual({
      ...owner,
      calls: 1,
      costMicros: 20_100,
    })
  })
})
