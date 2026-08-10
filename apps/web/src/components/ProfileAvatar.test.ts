import { describe, expect, it } from 'vitest'
import { automaticProfileColor, profileInitials } from '@/lib/profile'

describe('profile presentation', () => {
  it('uses stable automatic colors and display-name initials', () => {
    expect(automaticProfileColor('same-user')).toBe(automaticProfileColor('same-user'))
    expect(automaticProfileColor('same-user')).toMatch(/^#[0-9a-f]{6}$/)
    expect(profileInitials('Isaac Thoman')).toBe('IT')
    expect(profileInitials('')).toBe('?')
  })
})
