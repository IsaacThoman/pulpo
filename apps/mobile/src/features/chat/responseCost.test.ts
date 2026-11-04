import { describe, expect, it } from 'vitest'
import { formatResponseCost, responseCostMicros, responseMetaLabel } from './responseCost'

describe('response cost', () => {
  it('adds the API-equivalent reference to Pulpo usage like the web headline', () => {
    expect(responseCostMicros({ costMicros: 4_200 })).toBe(4_200)
    expect(responseCostMicros({ costMicros: 0, inferenceReferenceCostMicros: 12_500 })).toBe(12_500)
    expect(responseCostMicros({ costMicros: 1_000, inferenceReferenceCostMicros: 0 })).toBe(1_000)
  })

  it('has no cost before usage settles', () => {
    expect(responseCostMicros({})).toBeUndefined()
    expect(responseCostMicros({ costMicros: null, inferenceReferenceCostMicros: 5_000 })).toBeUndefined()
  })

  it('formats with four decimals', () => {
    expect(formatResponseCost(4_200)).toBe('$0.0042')
    expect(formatResponseCost(0)).toBe('$0.0000')
    expect(formatResponseCost(1_234_500)).toBe('$1.2345')
  })

  it('appends the cost to the token line only when shown', () => {
    expect(responseMetaLabel('12→34 tok', 4_200, true)).toBe('12→34 tok · $0.0042')
    expect(responseMetaLabel('12→34 tok', 4_200, false)).toBe('12→34 tok')
    expect(responseMetaLabel(undefined, 4_200, true)).toBe('$0.0042')
    expect(responseMetaLabel('12→34 tok', undefined, true)).toBe('12→34 tok')
    expect(responseMetaLabel(undefined, undefined, true)).toBeUndefined()
  })
})
