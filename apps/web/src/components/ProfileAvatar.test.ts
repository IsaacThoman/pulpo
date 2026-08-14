import { describe, expect, it } from 'vitest'
import { automaticProfileColor, PROFILE_COLORS, profileInitials } from '@/lib/profile'

describe('profile presentation', () => {
  it('uses stable automatic colors and display-name initials', () => {
    expect(automaticProfileColor('same-user')).toBe(automaticProfileColor('same-user'))
    expect(automaticProfileColor('same-user')).toMatch(/^#[0-9a-f]{6}$/)
    expect(PROFILE_COLORS).toContain(automaticProfileColor('same-user'))
    expect(profileInitials('Isaac Thoman')).toBe('IT')
    expect(profileInitials('')).toBe('?')
  })
})
