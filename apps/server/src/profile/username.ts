import { randomInt } from 'node:crypto'
import { RESERVED_PROFILE_USERNAMES } from '@pulpo/contracts'

const MIN_RANDOM_USERNAME_NUMBER = 1
const MAX_RANDOM_USERNAME_NUMBER = 2_147_483_647
const reservedProfileUsernames = new Set<string>(RESERVED_PROFILE_USERNAMES)

export function fillMissingUsernames(
  rows: Array<Record<string, unknown>>,
  nextInteger: () => number = () => randomInt(MIN_RANDOM_USERNAME_NUMBER, MAX_RANDOM_USERNAME_NUMBER + 1),
): void {
  const used = new Set(rows.flatMap((row) => (
    typeof row.username === 'string' && row.username.trim()
      ? [row.username.trim().toLowerCase()]
      : []
  )))

  for (const row of rows) {
    if (typeof row.username === 'string' && row.username.trim() && !reservedProfileUsernames.has(row.username.trim().toLowerCase())) continue
    let username: string
    do username = `pulpo${nextInteger()}`
    while (used.has(username))
    row.username = username
    used.add(username)
  }
}
