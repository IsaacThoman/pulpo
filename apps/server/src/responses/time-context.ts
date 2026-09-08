import { timeZoneSchema } from '@pulpo/contracts'

export const TIME_CONTEXT_INSTRUCTIONS = `Resolve relative dates such as "today" using the supplied local date and timezone. This context describes generation start time; for a long-running task, check the current time again when needed.
For a named venue, use its local timezone and date, and verify holiday or exceptional hours before applying regular weekly hours. Respect an explicit date or timezone in the user's request.
If the user's timezone is unknown, do not describe UTC as their local date. Use an explicitly identified location's timezone when possible, or ask when the timezone would change the answer.`

export interface GenerationTimeContext {
  timeZone?: string | null
  origin: string
}

/** Use the server's generation-start timestamp, never a queued or client-supplied date. */
export function generationTimeContext(response: GenerationTimeContext, startedAt: number): string {
  if (response.origin === 'api') return ''
  const parsed = timeZoneSchema.safeParse(response.timeZone)
  const timeZone = parsed.success ? parsed.data : 'UTC'
  const now = new Date(startedAt)
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(now)
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  }).format(now)
  return parsed.success
    ? `User timezone: ${timeZone}\nLocal date: ${date}\nLocal time: ${time}`
    : `User timezone: unknown\nReference timezone: UTC\nUTC date: ${date}\nUTC time: ${time}`
}

/** Replace our saved block after selecting a persisted agent prompt. */
export function withGenerationTimeContext(prompt: string, response: GenerationTimeContext, startedAt: number): string {
  const base = prompt.replace(/\n*\[Pulpo generation time context\]\n[\s\S]*?\n\[\/Pulpo generation time context\]/g, '').trim()
  const context = generationTimeContext(response, startedAt)
  if (!context) return base
  return [base, `[Pulpo generation time context]\n${TIME_CONTEXT_INSTRUCTIONS}\n\n${context}\n[/Pulpo generation time context]`].filter(Boolean).join('\n\n')
}
