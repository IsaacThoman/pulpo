import { describe, expect, it } from 'vitest'
import { addFileScope } from './file-scope'

describe('addFileScope', () => {
  it('appends new items once and lets the root cover everything', () => {
    expect(addFileScope([], ['a'])).toEqual(['a'])
    expect(addFileScope(['a'], ['a', 'b'])).toEqual(['a', 'b'])
    expect(addFileScope(['a', 'b'], ['root'])).toEqual(['root'])
    expect(addFileScope(['root'], ['a'])).toEqual(['root'])
  })
})
