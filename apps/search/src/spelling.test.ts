import { describe, expect, it } from 'vitest'
import type { SearchResponse } from './api'
import { suggestedSpelling } from './spelling'

const sample: SearchResponse = {
  provider: 'kagi',
  results: [
    { title: 'Equidistant Definition', url: 'https://dictionary.example/equidistant', snippet: '' },
    { title: 'Geometry and Equidistant Objects', url: 'https://math.example/equidistant', snippet: '' },
  ],
  related: ['equidistant definition', 'geometry definition'],
}

describe('search spelling suggestions', () => {
  it('supports one near spelling backed by a provider suggestion and multiple sources', () => {
    expect(suggestedSpelling('equidistnat definition', sample)).toBe('equidistant definition')
    expect(suggestedSpelling('equidistnt definition', sample)).toBe('equidistant definition')
  })

  it('preserves operators, exact requests, and spellings found in results', () => {
    expect(suggestedSpelling('"equidistnat" definition', sample)).toBeUndefined()
    expect(suggestedSpelling('equidistnat definition site:math.example', sample)).toBeUndefined()
    const usesOriginal = { ...sample, results: [...sample.results, { ...sample.results[0], title: 'Equidistnat Definition' }] }
    expect(suggestedSpelling('equidistnat definition', usesOriginal)).toBeUndefined()
    expect(suggestedSpelling('interesting definition', sample)).toBeUndefined()
  })

  it('does not infer a correction from repeated pages on the same host', () => {
    const sameHost = { ...sample, results: [sample.results[0], { ...sample.results[1], url: 'https://dictionary.example/facts' }] }
    expect(suggestedSpelling('equidistnat definition', sameHost)).toBeUndefined()
  })
})
