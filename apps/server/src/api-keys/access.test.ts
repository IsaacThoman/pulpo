import { describe, expect, it } from 'vitest'
import { apiKeyOwnerCanSpend } from './access.js'

describe('API-key owner access', () => {
  it.each(['user', 'admin'] as const)('allows an active %s', (role) => {
    expect(apiKeyOwnerCanSpend({ role, blocked: false })).toBe(true)
  })

  it('denies pending users', () => {
    expect(apiKeyOwnerCanSpend({ role: 'pending', blocked: false })).toBe(false)
  })

  it('denies blocked users regardless of role', () => {
    expect(apiKeyOwnerCanSpend({ role: 'user', blocked: true })).toBe(false)
  })
})
