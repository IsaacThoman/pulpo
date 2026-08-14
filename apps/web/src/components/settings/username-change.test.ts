import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))

vi.mock('@/lib/api', () => ({ apiRequest }))

import { normalizeUsername, requestUsernameChange, usernameChangeValidationError } from './username-change'

describe('username change', () => {
  beforeEach(() => apiRequest.mockReset())

  it('normalizes a leading at-sign and case', () => {
    expect(normalizeUsername(' @Isaac_7 ')).toBe('isaac_7')
  })

  it('requires a valid, changed username', () => {
    expect(usernameChangeValidationError('_isaac', 'old_name')).toContain('begin and end')
    expect(usernameChangeValidationError('old_name', 'old_name')).toBe('Enter a different username.')
    expect(usernameChangeValidationError('new_name', 'old_name')).toBeNull()
  })

  it('posts the normalized username to the account endpoint', async () => {
    apiRequest.mockResolvedValue({ user: {} })

    await requestUsernameChange(' @New_Name ')

    expect(apiRequest).toHaveBeenCalledWith('/api/me', {
      method: 'PATCH',
      body: { username: 'new_name' },
    })
  })
})
