import { usernameSchema } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import type { AuthUser } from '@/stores/auth'
import { ui } from '@/i18n/ui'

export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase()
}

export function usernameChangeValidationError(value: string, currentUsername: string): string | null {
  const username = normalizeUsername(value)
  const parsed = usernameSchema.safeParse(username)
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Enter a valid username.'
  if (username === currentUsername) return ui("Enter a different username.")
  return null
}

export function requestUsernameChange(username: string): Promise<{ user: Omit<AuthUser, 'initials'> }> {
  return apiRequest('/api/me', {
    method: 'PATCH',
    body: { username: normalizeUsername(username) },
  })
}
