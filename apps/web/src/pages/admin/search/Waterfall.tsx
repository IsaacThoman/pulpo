import type { AdminSearchRequestRow } from '@pulpo/contracts'
import { formatMs } from '@/features/admin-analytics/format'
import { VIZ_OTHER } from '@/features/admin-analytics/palette'
import { ui, uit } from '@/i18n/ui'
import { failedAttempt, outcomeLabel, providerColor, providerLabel } from './labels'

/** Failed attempts keep their provider color and gain stripes, so the pattern reads without color. */
const FAILED_PATTERN = 'repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in oklab, var(--card) 70%, transparent) 3px 5px)'

interface Segment { key: string; start: number; duration: number; color: string; label: string; striped?: boolean }

function segments(row: AdminSearchRequestRow): Segment[] {
  const request = row.phases.requestMs ?? 0
  const items: Segment[] = []
  if (request) items.push({ key: 'request', start: 0, duration: request, color: VIZ_OTHER, label: uit`Auth and parsing ${formatMs(request)}` })
  if (row.phases.settingsMs) {
    items.push({ key: 'settings', start: request, duration: row.phases.settingsMs, color: VIZ_OTHER, label: uit`Settings lookup ${formatMs(row.phases.settingsMs)}` })
  }
  row.attempts.forEach((attempt, index) => {
    if (attempt.outcome.startsWith('skipped_')) return
    items.push({
      key: `attempt-${index}`, start: attempt.startMs, duration: attempt.durationMs, color: providerColor(attempt.provider),
      label: `${providerLabel(attempt.provider)}: ${outcomeLabel(attempt.outcome)} ${formatMs(attempt.durationMs)}`,
      striped: failedAttempt(attempt.outcome),
    })
  })
  return items
}

/**
 * One request's timeline on a shared scale: overhead phases in gray, each
 * provider attempt in its color. The track is the request's whole duration.
 */
export function Waterfall({ row, scaleMs }: { row: AdminSearchRequestRow; scaleMs: number }) {
  const scale = Math.max(scaleMs, row.durationMs, 1)
  const items = segments(row)
  const description = items.map((item) => item.label).join(', ')
  return (
    <div className="relative h-3 w-full min-w-40" role="img" aria-label={description || ui('No timing recorded')} title={description}>
      <div className="absolute inset-y-0 left-0 rounded-sm bg-muted-foreground/25" style={{ width: `${(row.durationMs / scale) * 100}%` }} />
      {items.map((item) => (
        <div
          key={item.key}
          className="absolute inset-y-0 rounded-sm"
          style={{
            left: `${Math.min(100, (item.start / scale) * 100)}%`,
            width: `max(2px, ${(item.duration / scale) * 100}%)`,
            background: item.color,
            backgroundImage: item.striped ? FAILED_PATTERN : undefined,
          }}
        />
      ))}
    </div>
  )
}

export function WaterfallLegend({ providers }: { providers: string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm" style={{ background: VIZ_OTHER }} aria-hidden />
        {ui('Auth, parsing and settings')}
      </li>
      {providers.map((provider) => (
        <li key={provider} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: providerColor(provider) }} aria-hidden />
          {providerLabel(provider)}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm" style={{ background: 'var(--muted-foreground)', backgroundImage: FAILED_PATTERN }} aria-hidden />
        {ui('Failed or timed out')}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm bg-muted-foreground/25" aria-hidden />
        {ui('Credit holds, billing and other overhead')}
      </li>
    </ul>
  )
}
