import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 7 * 24 * 60 * 60 * 1_000,
      retry: (failures, error) => navigator.onLine && failures < 2 && !(error instanceof Error && error.name === 'AbortError'),
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'offlineFirst' },
  },
})
