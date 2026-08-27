import { UNKNOWN_MODEL_ID } from '@pulpo/contracts'
import { describe, expect, it } from 'vitest'
import { canonicalUsageModels, decodeUsageCursor, encodeUsageCursor, publicModel, resolveUsageModelAlias } from './public.js'
import { usageQuerySchema, usageRecordsQuerySchema } from './routes.js'

describe('friends leaderboard usage', () => {
  it('round trips stable timestamp and id cursors', () => {
    const cursor = { createdAt: new Date('2026-08-01T12:00:00.000Z'), id: '00000000-0000-4000-8000-000000000001' }
    expect(decodeUsageCursor(encodeUsageCursor(cursor))).toEqual(cursor)
  })

  it('rejects malformed cursors', () => {
    expect(() => decodeUsageCursor('not-a-cursor')).toThrow('usage cursor is invalid')
  })

  it('validates leaderboard ranges, time zones, and record limits', () => {
    expect(usageQuerySchema.parse({})).toEqual({ range: '30d', timeZone: 'UTC' })
    expect(usageRecordsQuerySchema.parse({ range: '7d', timeZone: 'America/New_York', limit: '100' }).limit).toBe(100)
    expect(() => usageQuerySchema.parse({ range: 'year' })).toThrow()
    expect(() => usageQuerySchema.parse({ timeZone: 'Mars/Olympus_Mons' })).toThrow('Invalid time zone')
    expect(() => usageRecordsQuerySchema.parse({ limit: '101' })).toThrow()
  })

  it('hides private model metadata', () => {
    expect(publicModel({ visible: false, id: 'secret-model', name: 'Secret', logo: 'secret' }))
      .toEqual({ id: 'other', name: 'Other', logo: null })
  })

  it('keeps the unknown model placeholder identifiable', () => {
    expect(publicModel({ visible: false, id: UNKNOWN_MODEL_ID, name: 'unknown model', logo: 'pulpo' }))
      .toEqual({ id: UNKNOWN_MODEL_ID, name: 'unknown model', logo: 'pulpo' })
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
