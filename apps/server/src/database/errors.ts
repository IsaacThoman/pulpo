export function hasDatabaseErrorCode(error: unknown, code: string): boolean {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if ('code' in current && current.code === code) return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}
