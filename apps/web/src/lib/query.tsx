import { type PropsWithChildren, useEffect } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { indexedDbPersister } from './local-first/database'
import { queryClient } from './query-client'
import { shouldPersistQuery } from './query-persistence'

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
