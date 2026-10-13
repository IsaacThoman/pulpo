import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 7 * 24 * 60 * 60 * 1_000,
      retry: (failures, error) => navigator.onLine && failures < 2
        && !(error instanceof Error && error.name === 'AbortError')
        && !(error instanceof ApiError && error.status === 429 && error.retryAfterMs === undefined),
      retryDelay: (attempt, error) => Math.max(
        Math.min(1_000 * 2 ** attempt, 30_000),
        error instanceof ApiError ? error.retryAfterMs ?? 0 : 0,
      ),
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'offlineFirst' },
  },
})
