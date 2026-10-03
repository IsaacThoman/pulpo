import { useQuery } from '@tanstack/react-query'
import type { AnalyticsSearch } from '@/features/admin-analytics/search-params'
import { apiRequest } from '@/lib/api'

export const INSIGHT_FILTER_KEYS = ['platform', 'plan', 'origin', 'model'] as const

export type InsightsEndpoint = 'models' | 'settings' | 'tools' | 'pools' | 'features' | 'engagement'

/** One section's data; each section loads independently with the page filters. */
export function useInsights<T>(endpoint: InsightsEndpoint, search: AnalyticsSearch) {
  const query = search.query(INSIGHT_FILTER_KEYS)
  return useQuery({
    queryKey: ['admin-analytics', 'insights', endpoint, query],
    queryFn: () => apiRequest<T>(`/api/admin/analytics/insights/${endpoint}?${query}`),
    placeholderData: (previous) => previous,
  })
}

export function share(part: number, total: number): number {
  return total > 0 ? part / total : 0
}
