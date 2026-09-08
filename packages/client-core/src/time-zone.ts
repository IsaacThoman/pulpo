import { timeZoneSchema } from '@pulpo/contracts'

/** Resolve at request creation so timezone changes are picked up without restarting. */
export function deviceTimeZone(): string | undefined {
  try {
    const result = timeZoneSchema.safeParse(Intl.DateTimeFormat().resolvedOptions().timeZone)
    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}
