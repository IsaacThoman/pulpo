import { describe, expect, it } from 'vitest'
import { usageRequestSequence } from './usage-request-sequence.js'

describe('usage request sequence', () => {
  it('labels agent generations by turn', () => {
    expect(usageRequestSequence({ purpose: 'generation', retryAttempt: 1, turnNumber: 41 }))
      .toEqual({ kind: 'turn', number: 41 })
  })

  it('labels internal compaction calls instead of showing a retry attempt', () => {
    expect(usageRequestSequence({ purpose: 'compaction', retryAttempt: 1, turnNumber: null }))
      .toEqual({ kind: 'compaction' })
  })

  it('preserves attempt labels for other unnumbered calls', () => {
    expect(usageRequestSequence({ purpose: 'ocr', retryAttempt: 2, turnNumber: null }))
      .toEqual({ kind: 'attempt', number: 2 })
  })
})
