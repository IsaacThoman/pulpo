import { describe, expect, it } from 'vitest'
import { changeMode, stricterMode, workspacePath } from './command-context.js'
import { createLineMatcher } from './matcher.js'
import { FilesCommandError, splitPath } from './scope.js'

describe('Files paths', () => {
  it('splits agent paths, normalizing names and refusing dot segments', () => {
    expect(splitPath('/Projects//Plan.md/')).toEqual(['Projects', 'Plan.md'])
    expect(splitPath(' Projects / Café.md ')).toEqual(['Projects', 'Café.md'])
    expect(splitPath('')).toEqual([])
    expect(() => splitPath('Projects/../x')).toThrow(FilesCommandError)
    expect(() => splitPath('./x')).toThrow(FilesCommandError)
  })

  it('accepts only normalized absolute workspace paths', () => {
    expect(workspacePath('/workspace/files/a.md')).toBe('/workspace/files/a.md')
    expect(workspacePath('/workspace/files/')).toBe('/workspace/files')
    for (const path of ['/workspace', '/workspace/', 'workspace/a', '/etc/passwd', '/workspace/../etc', '/workspace/a/./b', '/workspace//a', '/workspace/a\0']) {
      expect(() => workspacePath(path), path).toThrow(FilesCommandError)
    }
  })
})

describe('access modes', () => {
  it('uses the more restrictive mode for moves', () => {
    expect(stricterMode('write', 'suggest')).toBe('suggest')
    expect(stricterMode('suggest', 'read')).toBe('read')
    expect(stricterMode('write', 'write')).toBe('write')
    expect(stricterMode('write', null)).toBeNull()
  })

  it('turns read only and out-of-scope items into explanations', () => {
    expect(changeMode('suggest', 'a')).toBe('suggest')
    expect(() => changeMode('read', 'Notes.md')).toThrow(/"Notes.md" is read only/)
    expect(() => changeMode(null, 'x')).toThrow(/not attached/)
  })
})

describe('createLineMatcher', () => {
  it('matches regular expressions, literal text, and case-insensitively', () => {
    expect(createLineMatcher('^a.c$')(['abc', 'a.c', 'xabc'])).toEqual([0, 1])
    expect(createLineMatcher('a.c', { fixed: true })(['abc', 'a.c'])).toEqual([1])
    expect(createLineMatcher('ABC', { ignoreCase: true })(['abc', 'abd'])).toEqual([0])
    expect(() => createLineMatcher('(')).toThrow(/Invalid pattern/)
  })

  it('stops patterns that backtrack without end', () => {
    const match = createLineMatcher('(a+)+$')
    const started = Date.now()
    expect(() => match([`${'a'.repeat(40)}!`])).toThrow(/took too long/)
    expect(Date.now() - started).toBeLessThan(5_000)
    // The budget is spent for the whole search.
    expect(() => match(['a'])).toThrow(/took too long/)
  }, 10_000)
})
