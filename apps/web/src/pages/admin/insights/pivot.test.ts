import { describe, expect, it } from 'vitest'
import { fillBuckets, pivotSeries } from './pivot'

describe('fillBuckets', () => {
  it('fills missing days between the first and last bucket', () => {
    expect(fillBuckets(['2026-03-03T00:00', '2026-03-01T00:00'], 'day')).toEqual(['2026-03-01T00:00', '2026-03-02T00:00', '2026-03-03T00:00'])
  })

  it('fills hours across a day boundary', () => {
    expect(fillBuckets(['2026-03-01T23:00', '2026-03-02T01:00'], 'hour')).toEqual(['2026-03-01T23:00', '2026-03-02T00:00', '2026-03-02T01:00'])
  })
})

describe('pivotSeries', () => {
  it('pivots long points into zero-filled rows keyed by bucket', () => {
    const { rows, keys } = pivotSeries([
      { bucket: '2026-03-01T00:00', key: 'a', value: 2 },
      { bucket: '2026-03-03T00:00', key: 'b', value: 5 },
      { bucket: '2026-03-03T00:00', key: 'a', value: 1 },
    ], 'day')
    expect(keys).toEqual(['b', 'a'])
    expect(rows).toEqual([
      { bucket: '2026-03-01T00:00', a: 2, b: 0 },
      { bucket: '2026-03-02T00:00', a: 0, b: 0 },
      { bucket: '2026-03-03T00:00', a: 1, b: 5 },
    ])
  })

  it('folds keys beyond the limit and incoming "other" into a trailing other series', () => {
    const { rows, keys } = pivotSeries([
      { bucket: '2026-03-01T00:00', key: 'big', value: 10 },
      { bucket: '2026-03-01T00:00', key: 'mid', value: 5 },
      { bucket: '2026-03-01T00:00', key: 'small', value: 1 },
      { bucket: '2026-03-01T00:00', key: 'other', value: 3 },
    ], 'day', 2)
    expect(keys).toEqual(['big', 'mid', 'other'])
    expect(rows).toEqual([{ bucket: '2026-03-01T00:00', big: 10, mid: 5, other: 4 }])
  })

  it('omits the other series when nothing is folded', () => {
    expect(pivotSeries([{ bucket: '2026-03-01T00:00', key: 'a', value: 1 }], 'day').keys).toEqual(['a'])
  })
})
