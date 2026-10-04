import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query'
import type { AdminRequestDetail, AdminRequestPage, AdminRequestSort, AdminRequestsOverview } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'

export const REQUESTS_PAGE_SIZE = 50
const BASE = '/api/admin/analytics/requests'

export type RequestPages = InfiniteData<AdminRequestPage, string | null>

export const requestsKeys = {
  all: ['admin-analytics', 'requests'] as const,
  overview: (query: string) => ['admin-analytics', 'requests', 'overview', query] as const,
  list: (query: string, sort: AdminRequestSort) => ['admin-analytics', 'requests', 'list', query, sort] as const,
  detail: (id: string) => ['admin-analytics', 'requests', 'detail', id] as const,
}

export function requestsPageUrl(query: string, sort: AdminRequestSort, cursor: string | null): string {
  const params = new URLSearchParams(query)
  params.set('sort', sort)
  params.set('limit', String(REQUESTS_PAGE_SIZE))
  if (cursor) params.set('cursor', cursor)
  return `${BASE}?${params}`
}

export function useRequestsOverview(query: string) {
  return useQuery({
    queryKey: requestsKeys.overview(query),
    queryFn: ({ signal }) => apiRequest<AdminRequestsOverview>(`${BASE}/overview?${query}`, { signal }),
    placeholderData: (previous) => previous,
  })
}

export function useRequestsList(query: string, sort: AdminRequestSort) {
  return useInfiniteQuery({
    queryKey: requestsKeys.list(query, sort),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => apiRequest<AdminRequestPage>(requestsPageUrl(query, sort, pageParam), { signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
}

export function useRequestDetail(id: string) {
  return useQuery({
    queryKey: requestsKeys.detail(id),
    queryFn: ({ signal }) => apiRequest<AdminRequestDetail>(`${BASE}/${encodeURIComponent(id)}`, { signal }),
  })
}
