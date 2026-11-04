import { Platform } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useSessionStore } from '../../store/session'
import { appStoreHostAllowed, appStoreOffer, type AppStoreProductIds } from './availability'
import { storeKit } from './storeKit'

/** The plans this build may buy from the signed-in instance, or null when it offers no purchases. */
export function useAppStoreOffer(): AppStoreProductIds | null {
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const signedIn = useSessionStore((state) => Boolean(state.user))
  const capability = useSessionStore((state) => state.config?.capabilities.appStoreBilling)
  const eligible = Boolean(storeKit && signedIn && capability && appStoreHostAllowed(instanceUrl))
  // The build's StoreKit environment never changes while it runs.
  const environment = useQuery({
    queryKey: ['app-store-environment'],
    queryFn: async () => (await storeKit?.environment()) ?? null,
    enabled: eligible,
    staleTime: Infinity,
    gcTime: Infinity,
    networkMode: 'always',
  })
  if (!eligible) return null
  return appStoreOffer({ platform: Platform.OS, instanceUrl, capability, environment: environment.data })
}
