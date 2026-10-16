import { describe, expect, it } from 'vitest'
import { addFileScope, fileAccessMode, scopedFileAccess } from './file-scope'

describe('addFileScope', () => {
  it('appends new items once, keeping items inside an added folder or all files', () => {
    expect(addFileScope([], ['a'])).toEqual(['a'])
    expect(addFileScope(['a'], ['a', 'b'])).toEqual(['a', 'b'])
    expect(addFileScope(['projects'], ['plan'])).toEqual(['projects', 'plan'])
    expect(addFileScope(['root'], ['a'])).toEqual(['root', 'a'])
  })
})

describe('Files access modes', () => {
  it('keeps the modes of attached items only', () => {
    expect(scopedFileAccess(['a', 'root'], { a: 'write', b: 'read', root: 'read' })).toEqual({ a: 'write', root: 'read' })
    expect(scopedFileAccess([], { a: 'write' })).toEqual({})
  })

  it('defaults to suggesting changes', () => {
    expect(fileAccessMode({ a: 'read' }, 'a')).toBe('read')
    expect(fileAccessMode({ a: 'read' }, 'b')).toBe('suggest')
    expect(fileAccessMode(undefined, 'b')).toBe('suggest')
  })
})
