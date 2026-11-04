import { normalizeUsername, usernameFormatError } from '@pulpo/client-core'
import { apiRequest } from '@/lib/api'
import type { AuthUser } from '@/stores/auth'
import { ui } from '@/i18n/ui'

export { normalizeUsername } from '@pulpo/client-core'

export function usernameChangeValidationError(value: string, currentUsername: string): string | null {
  const formatError = usernameFormatError(value)
  if (formatError) return formatError
  if (normalizeUsername(value) === currentUsername) return ui("Enter a different username.")
  return null
}

export function requestUsernameChange(username: string): Promise<{ user: Omit<AuthUser, 'initials'> }> {
  return apiRequest('/api/me', {
    method: 'PATCH',
    body: { username: normalizeUsername(username) },
  })
}
