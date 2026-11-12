import { usernameSchema } from '@pulpo/contracts'

/** Accepts `@Name` or ` name ` the way people type it; the server stores lowercase. */
export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase()
}

const characterName = (character: string) => /\s/.test(character) ? 'spaces' : `“${character}”`

/**
 * Names the characters a username can't hold, like `.` in `isaac.t`, so people see what to remove
 * instead of only the rule.
 */
function disallowedCharactersError(username: string): string | null {
  const names = [...new Set(Array.from(username.replace(/[a-z0-9_]/g, ''), characterName))]
  if (names.length === 0) return null
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
  return `Usernames can’t contain ${list}. Use only letters, numbers, or underscores.`
}

/** The first username rule `value` breaks, worded for people, or null when it is valid. */
export function usernameFormatError(value: string): string | null {
  const username = normalizeUsername(value)
  const parsed = usernameSchema.safeParse(username)
  if (parsed.success) return null
  return disallowedCharactersError(username) ?? parsed.error.issues[0]?.message ?? 'Enter a valid username.'
}
