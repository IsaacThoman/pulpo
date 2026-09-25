import type { CostWarningItem } from '@pulpo/contracts'

export function costWarningItemId(responseId: string): string {
  return `${responseId}:cost-warning`
}

/**
 * Returns the warning item to publish after the response's accrued cost changes: first when the
 * cost reaches the user's threshold, then whenever it rises further. Otherwise returns undefined.
 */
export function nextCostWarning(options: {
  responseId: string
  thresholdMicros: number | undefined
  costMicros: number
  current: CostWarningItem | undefined
  now?: Date
}): CostWarningItem | undefined {
  const { responseId, thresholdMicros, costMicros, current } = options
  if (current) {
    return costMicros > current.cost_micros ? { ...current, cost_micros: costMicros } : undefined
  }
  if (thresholdMicros === undefined || costMicros < thresholdMicros) return undefined
  return {
    id: costWarningItemId(responseId),
    type: 'pulpo_cost_warning',
    threshold_micros: thresholdMicros,
    cost_micros: costMicros,
    triggered_at: (options.now ?? new Date()).toISOString(),
  }
}
