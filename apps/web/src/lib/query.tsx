import { type PropsWithChildren, useEffect } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { indexedDbPersister } from './local-first/database'
import { queryClient } from './query-client'

export function shouldPersistQuery(query: { queryKey: readonly unknown[]; state: { status: string; data?: unknown } }): boolean {
  if (query.state.status !== 'success') return false
  if (query.queryKey[0] === 'chat') {
    return !(query.state.data as { temporary?: boolean } | undefined)?.temporary
  }
  if (query.queryKey[0] === 'chats' && Array.isArray(query.state.data)) {
    return !query.state.data.some((chat) => (chat as { temporary?: boolean }).temporary)
  }
  return true
}

export function QueryProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    const onOnline = () => void queryClient.resumePausedMutations()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: indexedDbPersister,
        maxAge: 7 * 24 * 60 * 60 * 1_000,
        buster: 'pulpo-web-v2',
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistQuery,
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
