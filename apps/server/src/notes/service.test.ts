import { describe, expect, it } from 'vitest'
import { noteExcerpt } from './service.js'

describe('noteExcerpt', () => {
  it('normalizes collaborative document text and caps list previews', () => {
    const source = `  First\n\n  second   ${'x'.repeat(250)}`
    const excerpt = noteExcerpt(source)
    expect(excerpt.startsWith('First second')).toBe(true)
    expect(excerpt).toHaveLength(180)
  })
})
