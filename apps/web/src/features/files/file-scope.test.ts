import { describe, expect, it } from 'vitest'
import { addFileScope, pruneFileScope } from './file-scope'

describe('addFileScope', () => {
  it('appends new items once and lets the root cover everything', () => {
    expect(addFileScope([], ['a'])).toEqual(['a'])
    expect(addFileScope(['a'], ['a', 'b'])).toEqual(['a', 'b'])
    expect(addFileScope(['a', 'b'], ['root'])).toEqual(['root'])
    expect(addFileScope(['root'], ['a'])).toEqual(['root'])
  })
})

describe('pruneFileScope', () => {
  it('drops items inside a scoped folder and keeps the unknown', () => {
    const ancestors: Record<string, string[]> = { plan: ['projects'], deep: ['other', 'projects'], loose: ['notes'] }
    expect(pruneFileScope(['plan', 'deep', 'loose', 'projects', 'unknown'], (id) => ancestors[id])).toEqual(['loose', 'projects', 'unknown'])
  })
})
