import { usernameSchema } from '@pulpo/contracts'

/** Accepts `@Name` or ` name ` the way people type it; the server stores lowercase. */
export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase()
}

/** The first username rule `value` breaks, worded for people, or null when it is valid. */
export function usernameFormatError(value: string): string | null {
  const parsed = usernameSchema.safeParse(normalizeUsername(value))
  return parsed.success ? null : parsed.error.issues[0]?.message ?? 'Enter a valid username.'
}
