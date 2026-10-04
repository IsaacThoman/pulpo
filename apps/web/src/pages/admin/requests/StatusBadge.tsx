import { Badge } from '@/components/ui/badge'
import { VIZ_STATUS } from '@/features/admin-analytics/palette'
import { statusLabel } from './filters'

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return VIZ_STATUS.completed
    case 'failed': return VIZ_STATUS.failed
    case 'incomplete': return VIZ_STATUS.incomplete
    case 'cancelled': return VIZ_STATUS.cancelled
    default: return VIZ_STATUS.inFlight
  }
}

/** Status label with its reserved colour as a dot; in-flight requests pulse. */
export function StatusBadge({ status }: { status: string }) {
  const live = status === 'in_progress' || status === 'queued'
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={live ? 'inline-block size-1.5 animate-pulse rounded-full' : 'inline-block size-1.5 rounded-full'} style={{ background: statusColor(status) }} aria-hidden />
      {statusLabel(status)}
    </Badge>
  )
}
