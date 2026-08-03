import { describe, expect, it } from 'vitest'
import { canonicalUsageModels, decodeUsageCursor, encodeUsageCursor, publicModel, publicParticipant } from './public.js'

describe('public leaderboard usage', () => {
  it('round trips stable timestamp and id cursors', () => {
    const cursor = { createdAt: new Date('2026-08-01T12:00:00.000Z'), id: '00000000-0000-4000-8000-000000000001' }
    expect(decodeUsageCursor(encodeUsageCursor(cursor))).toEqual(cursor)
  })

  it('rejects malformed cursors', () => {
    expect(() => decodeUsageCursor('not-a-cursor')).toThrow('usage cursor is invalid')
  })

  it('removes opted-out identity fields', () => {
    expect(publicParticipant({ visible: false, name: 'Private name', nickname: 'Private nick', color: '#ff0000' }))
      .toEqual({ name: 'Anonymous', color: null, anonymous: true })
  })

  it('uses public nicknames and hides private model metadata', () => {
    expect(publicParticipant({ visible: true, name: 'Name', nickname: 'Nick', color: '#00ff00' }))
      .toEqual({ name: 'Nick', color: '#00ff00', anonymous: false })
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
})
