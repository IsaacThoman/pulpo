import { describe, expect, it } from 'vitest'
import { addFileScope } from './file-scope'

describe('addFileScope', () => {
  it('appends new items once, keeping items inside an added folder or all files', () => {
    expect(addFileScope([], ['a'])).toEqual(['a'])
    expect(addFileScope(['a'], ['a', 'b'])).toEqual(['a', 'b'])
    expect(addFileScope(['projects'], ['plan'])).toEqual(['projects', 'plan'])
    expect(addFileScope(['root'], ['a'])).toEqual(['root', 'a'])
  })
})
