import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))

vi.mock('@/lib/api', () => ({ apiRequest }))

import { PasswordSettings } from './PasswordSettings'
import { passwordChangeValidationError, requestPasswordChange } from './password-change'

describe('PasswordSettings', () => {
  beforeEach(() => apiRequest.mockReset())

  it('renders the account settings control', () => {
    const markup = renderToStaticMarkup(<PasswordSettings />)
    expect(markup).toContain('Update the password used to sign in to your account.')
    expect(markup).toContain('Change password')
  })

  it('validates password-change input', () => {
    expect(passwordChangeValidationError({ currentPassword: '', newPassword: '', confirmation: '' }))
      .toBe('Enter your current password.')
    expect(passwordChangeValidationError({ currentPassword: 'current-password', newPassword: 'short', confirmation: 'short' }))
      .toBe('New password must be at least 8 characters.')
    expect(passwordChangeValidationError({ currentPassword: 'same-password', newPassword: 'same-password', confirmation: 'same-password' }))
      .toBe('New password must be different from the current password.')
    expect(passwordChangeValidationError({ currentPassword: 'current-password', newPassword: 'new-password', confirmation: 'different-password' }))
      .toBe('New passwords do not match.')
    expect(passwordChangeValidationError({ currentPassword: 'current-password', newPassword: 'new-password', confirmation: 'new-password' }))
      .toBeNull()
  })

  it('posts the current and new passwords to the account endpoint', async () => {
    apiRequest.mockResolvedValue(undefined)

    await requestPasswordChange('current-password', 'new-password')

    expect(apiRequest).toHaveBeenCalledWith('/api/me/password', {
      method: 'POST',
      body: { currentPassword: 'current-password', newPassword: 'new-password' },
    })
  })
})
