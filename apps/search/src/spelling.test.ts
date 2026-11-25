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

  it('uses a first-ranked suggestion backed by distinct pages on the leading site', () => {
    const sameHost = { ...sample, results: [sample.results[0], { ...sample.results[1], url: 'https://dictionary.example/facts' }] }
    expect(suggestedSpelling('equidistnat definition', sameHost)).toBe('equidistant definition')
    const copy = { ...sameHost, results: [sample.results[0], { ...sample.results[0], url: sample.results[0].url + '#definition' }] }
    expect(suggestedSpelling('equidistnat definition', copy)).toBeUndefined()
  })

  it('corrects a pair of typos together while preserving the original intent', () => {
    const data: SearchResponse = {
      provider: 'kagi',
      results: [
        { title: 'Block Editor Handbook – WordPress Developer Resources', url: 'https://developer.wordpress.org/block-editor/', snippet: 'Learn about the Gutenberg editor.' },
        { title: 'The unofficial block editor handbook for WordPress', url: 'https://blockhandbook.com/', snippet: '' },
        { title: 'Say Hello to Gutenberg, the WordPress Editor', url: 'https://wordpress.org/gutenberg/', snippet: '' },
      ],
      related: ['wrodpress gutenburg handbook pdf', 'wrodpress gutenburg handbook plugin',
        'wrodpress gutenburg handbook 2024', 'wrodpress gutenburg handbooks', 'wrodpress gutenburg handbook 2023', 'wordpress gutenberg guide'],
    }
    expect(suggestedSpelling('wrodpress gutenburg handbook', data)).toBe('wordpress gutenberg handbook')
    expect(suggestedSpelling('wrodpress gutenburg handbook', { ...data, related: undefined })).toBe('wordpress gutenberg handbook')
    expect(suggestedSpelling('wrodpress gutenburg handbook', { ...data, results: data.results.slice(0, 2) }))
      .toBe('wordpress gutenburg handbook')
  })

  it('can infer a correction while retaining an exact alphanumeric course code', () => {
    const data: SearchResponse = { provider: 'kagi', results: [
      { title: 'Stanford CS229 – Complete Study Guide', url: 'https://study.example.org/cs229', snippet: '' },
      { title: 'Stanford Machine Learning Course Syllabus', url: 'https://community.example.net/cs229', snippet: 'Stanford CS229 course.' },
    ] }
    expect(suggestedSpelling('Stantford online machine learning cs229 syllabus', data))
      .toBe('stanford online machine learning cs229 syllabus')
    expect(suggestedSpelling('Stantford online machine learning "cs229" syllabus', data)).toBeUndefined()
  })
})
