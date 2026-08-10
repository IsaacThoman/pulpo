import { randomInt } from 'node:crypto'

const MIN_RANDOM_USERNAME_NUMBER = 1
const MAX_RANDOM_USERNAME_NUMBER = 2_147_483_647

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
    if (typeof row.username === 'string' && row.username.trim()) continue
    let username: string
    do username = `pulpo${nextInteger()}`
    while (used.has(username))
    row.username = username
    used.add(username)
  }
}
