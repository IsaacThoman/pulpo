import { apiRequest } from '@/lib/api'

export interface PasswordChangeValues {
  currentPassword: string
  newPassword: string
  confirmation: string
}

export function passwordChangeValidationError(values: PasswordChangeValues): string | null {
  if (!values.currentPassword) return 'Enter your current password.'
  if (values.newPassword.length < 8) return 'New password must be at least 8 characters.'
  if (values.newPassword === values.currentPassword) return 'New password must be different from the current password.'
  if (values.confirmation !== values.newPassword) return 'New passwords do not match.'
  return null
}

export function requestPasswordChange(currentPassword: string, newPassword: string): Promise<void> {
  return apiRequest<void>('/api/me/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  })
}
