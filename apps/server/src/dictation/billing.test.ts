import { describe, expect, it } from 'vitest'
import { dictationUsageMicros } from './billing.js'

describe('dictation billing', () => {
  it('prorates per-minute pricing at one-second granularity', () => {
    expect(dictationUsageMicros(12.1, 10_000)).toEqual({ billedSeconds: 13, costMicros: 2_167 })
    expect(dictationUsageMicros(60, 10_000)).toEqual({ billedSeconds: 60, costMicros: 10_000 })
    expect(dictationUsageMicros(60.01, 10_000)).toEqual({ billedSeconds: 61, costMicros: 10_167 })
  })

  it('does not bill disabled or invalid usage', () => {
    expect(dictationUsageMicros(10, 0)).toEqual({ billedSeconds: 0, costMicros: 0 })
    expect(dictationUsageMicros(0, 10_000)).toEqual({ billedSeconds: 0, costMicros: 0 })
  })
})
