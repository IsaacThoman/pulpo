import { type PropsWithChildren, useEffect } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { flushQueryPersistence, indexedDbPersister } from './local-first/database'
import { queryClient } from './query-client'
import { shouldPersistQuery } from './query-persistence'
import { isDesktopRuntime, runtimeInstanceUrl } from './runtime'

export function QueryProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    const onOnline = () => void queryClient.resumePausedMutations()
    const onHidden = () => { if (document.visibilityState === 'hidden') void flushQueryPersistence() }
    const onPageHide = () => { void flushQueryPersistence() }
    window.addEventListener('online', onOnline)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onHidden)
      void flushQueryPersistence()
    }
  }, [])

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: indexedDbPersister,
        maxAge: 7 * 24 * 60 * 60 * 1_000,
        buster: isDesktopRuntime() ? `pulpo-desktop-v1:${runtimeInstanceUrl()}` : 'pulpo-web-v3',
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistQuery,
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
