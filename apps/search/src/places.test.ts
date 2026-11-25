import { describe, expect, it } from 'vitest'
import { placeIntent } from './places'

describe('local places intent', () => {
  it('keeps landmark context and turns an explicit opening-hours request into a filter', () => {
    expect(placeIntent('coffee shops near Grand Central Terminal open now')).toEqual({
      query: 'coffee shops near Grand Central Terminal', openNow: true,
    })
    expect(placeIntent('hotels in Montréal?')).toEqual({ query: 'hotels in Montréal', location: 'Montréal', openNow: false })
    expect(placeIntent('café near Gare de Lyon')).toMatchObject({ query: 'café near Gare de Lyon' })
    expect(placeIntent('public library near Pike Place Market Seattle')).toMatchObject({ query: 'public library near Pike Place Market Seattle' })
  })

  it('asks for a user-supplied area when the search only says near me', () => {
    expect(placeIntent('cafés that are open now around here')).toEqual({
      query: 'cafés around here', openNow: true, needsLocation: { term: 'cafés', connector: 'around' },
    })
  })

  it('looks up dishes and cuisines with the same area and hours handling as venues', () => {
    expect(placeIntent('vegetarian ramen near Union Square SF')).toEqual({
      query: 'vegetarian ramen near Union Square SF', openNow: false,
    })
    expect(placeIntent('best tacos in Queens')).toEqual({
      query: 'best tacos in Queens', location: 'Queens', openNow: false,
    })
    expect(placeIntent('Thai food around here open now')).toEqual({
      query: 'Thai food around here', openNow: true, needsLocation: { term: 'Thai food', connector: 'around' },
    })
    expect(placeIntent('ice cream near Bryant Park')).toMatchObject({ query: 'ice cream near Bryant Park' })
  })

  it('leaves ordinary, exact, operator, and first-result searches with the Web provider', () => {
    for (const query of ['history of coffee', 'restaurants', 'hotels in Paris !', '"coffee shops" in Boston',
      'restaurants near Chicago site:example.com', 'cooking patterns in Rust']) {
      expect(placeIntent(query)).toBeUndefined()
    }
  })

  it.each([
    'how to make ramen in a pressure cooker',
    'recipe for sushi in a bowl',
    'pizza recipes in a cast iron pan',
    'the history of ramen in Japan',
    'history of coffee shops in Seattle',
    'pizza origins in Italy',
  ])('leaves informational searches such as %s with the Web provider', query => {
    expect(placeIntent(query)).toBeUndefined()
  })
})
