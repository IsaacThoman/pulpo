import type { InsightsEngagement } from '@pulpo/contracts'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/features/admin-analytics/components'
import { formatCount, formatPercent } from '@/features/admin-analytics/format'
import { activeLocale, ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'

const WEEKS = 8

function cohortLabel(cohortStart: string): string {
  const date = new Date(`${cohortStart}T00:00`)
  return Number.isNaN(date.getTime()) ? cohortStart : date.toLocaleDateString(activeLocale(), { month: 'short', day: 'numeric' })
}

/**
 * Weekly retention: one row per signup-week cohort, week 0 to 7. Shading is a
 * single hue whose opacity follows retention, and every cell prints its %.
 */
export function CohortTable({ cohorts, loading }: { cohorts: InsightsEngagement['cohorts']; loading?: boolean }) {
  if (loading) return <Skeleton className="h-48 w-full" />
  if (!cohorts.length) return <EmptyState />
  const weeks = Array.from({ length: WEEKS }, (_, week) => week)
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-max">
        <thead>
          <tr className="border-b">
            <th className="px-2 py-1.5">{ui('Cohort')}</th>
            <th className="px-2 py-1.5 text-right">{ui('Users')}</th>
            {weeks.map((week) => <th key={week} className="px-2 py-1.5 text-center">{uit`Week ${week}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => (
            <tr key={cohort.cohortStart}>
              <td className="px-2 py-1">{uit`Week of ${cohortLabel(cohort.cohortStart)}`}</td>
              <td className="px-2 py-1 text-right tabular-nums">{formatCount(cohort.size)}</td>
              {weeks.map((week) => {
                const ratio = cohort.retention[week]
                if (ratio === undefined) return <td key={week} className="px-0.5 py-0.5" />
                return (
                  <td key={week} className="px-0.5 py-0.5">
                    <div className="relative overflow-hidden rounded-sm text-center">
                      <div className="absolute inset-0" style={{ background: 'var(--viz-1)', opacity: Math.max(0.06, ratio * 0.9) }} aria-hidden />
                      <span className={cn('relative block px-2 py-1 tabular-nums', ratio > 0.5 ? 'text-white' : 'text-foreground')}>{formatPercent(ratio, 0)}</span>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
