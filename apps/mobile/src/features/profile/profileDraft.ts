import { DEFAULT_USAGE_VISIBILITY, type UsageVisibility } from '@pulpo/contracts'
import { normalizeUsername, usernameFormatError } from '@pulpo/client-core'

export const USERNAME_HINT = 'Friends can search by your username or display name. Use 3–30 lowercase letters, numbers, or underscores.'

/** Accounts cached before the setting existed lack it, and the server gave them the default. */
export const usageVisibilityOf = (user: { usageVisibility?: UsageVisibility } | null | undefined): UsageVisibility =>
  user?.usageVisibility ?? DEFAULT_USAGE_VISIBILITY

/**
 * The same choices as web. Pool members can always see usage, on every instance, so the narrowest
 * level is Pool-only rather than private.
 */
export const USAGE_VISIBILITY_OPTIONS: readonly { value: UsageVisibility; label: string }[] = [
  { value: 'pool', label: 'Private (Pool only)' },
  { value: 'friends', label: 'Friends' },
  { value: 'public', label: 'Public' },
]

export const USAGE_VISIBILITY_HINT = 'Who can see your usage stats and requests on your profile. Pool members can always see your usage.'

export interface ProfileDraft {
  /** What changed, ready for `PATCH /api/me`; empty when nothing did. */
  patch: { name?: string; username?: string; usageVisibility?: UsageVisibility }
  /** Shown under the username field; null while it is unchanged or valid. */
  usernameError: string | null
  canSave: boolean
}

/**
 * Compares the Edit Profile fields with the account and validates them like web does. Leaving out
 * `usageVisibility` keeps the account's level.
 */
export function profileDraft(
  user: { name: string; username: string; usageVisibility?: UsageVisibility } | null | undefined,
  name: string,
  username: string,
  usageVisibility = usageVisibilityOf(user),
): ProfileDraft {
  const trimmedName = name.trim()
  const nextUsername = normalizeUsername(username)
  const usernameChanged = Boolean(user) && nextUsername !== user!.username
  const usernameError = usernameChanged ? usernameFormatError(nextUsername) : null
  const patch: ProfileDraft['patch'] = {
    ...(user && trimmedName !== user.name ? { name: trimmedName } : {}),
    ...(usernameChanged && !usernameError ? { username: nextUsername } : {}),
    ...(user && usageVisibility !== usageVisibilityOf(user) ? { usageVisibility } : {}),
  }
  return { patch, usernameError, canSave: Boolean(user && trimmedName && !usernameError) }
}
