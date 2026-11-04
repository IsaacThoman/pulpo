import { describe, expect, it } from 'vitest'
import { normalizeUsername, usernameFormatError } from './profile.js'

describe('profile usernames', () => {
  it('normalizes a leading at-sign, spaces and case', () => {
    expect(normalizeUsername(' @Isaac_7 ')).toBe('isaac_7')
  })

  it('explains the first broken username rule', () => {
    expect(usernameFormatError('_isaac')).toContain('begin and end')
    expect(usernameFormatError('is')).toContain('3–30')
    expect(usernameFormatError('@New_Name')).toBeNull()
  })
})
