import { queryOptions } from '@tanstack/react-query'
import { mobileApi } from '../../api/client'

export const usageLimitsKey = (namespace: string) => ['usage-limits', namespace] as const

export function usageLimitsQuery(namespace: string) {
  return queryOptions({ queryKey: usageLimitsKey(namespace), queryFn: () => mobileApi.usageLimits() })
}
