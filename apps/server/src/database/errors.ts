export function hasDatabaseErrorCode(error: unknown, code: string): boolean {
  const seen = new Set<object>()
  let current = error

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if ('code' in current && current.code === code) return true
    current = 'cause' in current ? current.cause : undefined
  }

  return false
}

/** Database errors often embed full SQL parameters in message/stack; never log those. */
export function databaseErrorDetails(error: unknown): { code: string; operation: string } | undefined {
  const seen = new Set<unknown>()
  let current = error
  let databaseError = false
  let code = 'unknown'
  let operation = 'query'
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    const fields = current as Error & { code?: unknown; query?: unknown }
    if (current.name === 'DrizzleQueryError' || current.name === 'PostgresError') databaseError = true
    if (typeof fields.query === 'string') {
      databaseError = true // DrizzleQueryError inherits name='Error', including connection failures.
      const verb = fields.query.trim().match(/^(select|insert|update|delete|alter|create|drop|truncate)\b/i)?.[1]
      if (verb) operation = verb.toLowerCase()
    }
    if (typeof fields.code === 'string' && /^[0-9A-Z]{5}$/.test(fields.code)) code = fields.code
    current = current.cause
  }
  return databaseError ? { code, operation } : undefined
}

export function safeErrorMessage(error: unknown): string {
  const database = databaseErrorDetails(error)
  if (database) return `Database ${database.operation} failed (${database.code})`
  return error instanceof Error ? error.message : 'Unknown error'
}
