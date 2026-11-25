import { describe, expect, it } from 'vitest'
import { placeIntent } from './places'

describe('local places intent', () => {
  it('keeps landmark context and turns an explicit opening-hours request into a filter', () => {
    expect(placeIntent('coffee shops near Grand Central Terminal open now')).toEqual({
      query: 'coffee shops near Grand Central Terminal', openNow: true,
    })
    expect(placeIntent('hotels in Montréal?')).toEqual({ query: 'hotels in Montréal', location: 'Montréal', openNow: false })
    expect(placeIntent('café near Gare de Lyon')).toMatchObject({ query: 'café near Gare de Lyon' })
  })

  it('asks for a user-supplied area when the search only says near me', () => {
    expect(placeIntent('cafés that are open now around here')).toEqual({
      query: 'cafés around here', openNow: true, needsLocation: { term: 'cafés', connector: 'around' },
    })
  })

  it('leaves ordinary, exact, operator, and first-result searches with the Web provider', () => {
    for (const query of ['history of coffee', 'restaurants', 'hotels in Paris !', '"coffee shops" in Boston',
      'restaurants near Chicago site:example.com', 'cooking patterns in Rust']) {
      expect(placeIntent(query)).toBeUndefined()
    }
  })
})
