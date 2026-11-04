import { normalizeUsername, usernameFormatError } from '@pulpo/client-core'

export const USERNAME_HINT = 'Friends can search by your username or display name. Use 3–30 lowercase letters, numbers, or underscores.'

export interface ProfileDraft {
  /** What changed, ready for `PATCH /api/me`; empty when nothing did. */
  patch: { name?: string; username?: string }
  /** Shown under the username field; null while it is unchanged or valid. */
  usernameError: string | null
  canSave: boolean
}

/** Compares the Edit Profile fields with the account and validates them like web does. */
export function profileDraft(user: { name: string; username: string } | null | undefined, name: string, username: string): ProfileDraft {
  const trimmedName = name.trim()
  const nextUsername = normalizeUsername(username)
  const usernameChanged = Boolean(user) && nextUsername !== user!.username
  const usernameError = usernameChanged ? usernameFormatError(nextUsername) : null
  const patch: ProfileDraft['patch'] = {
    ...(user && trimmedName !== user.name ? { name: trimmedName } : {}),
    ...(usernameChanged && !usernameError ? { username: nextUsername } : {}),
  }
  return { patch, usernameError, canSave: Boolean(user && trimmedName && !usernameError) }
}
