import { describe, expect, it } from 'vitest'
import { truncateUtf8 } from './output.js'

describe('agent tool output retention', () => {
  it('limits output by UTF-8 bytes without splitting characters', () => {
    expect(truncateUtf8('plain text', 5)).toBe('plain')
    expect(truncateUtf8('a🐙b', 5)).toBe('a🐙')
    expect(Buffer.byteLength(truncateUtf8('🐙🐙', 7), 'utf8')).toBeLessThanOrEqual(7)
  })
})
