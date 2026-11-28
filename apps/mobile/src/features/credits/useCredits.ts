import { useEffect, useState } from 'react'
import { AppState, Linking, Platform } from 'react-native'
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, mobileApi } from '../../api/client'
import { cacheNamespace } from '../../data/schema'
import { useSessionStore } from '../../store/session'
import { appStoreHostAllowed } from '../app-store/availability'
import { storeKit } from '../app-store/storeKit'
import { creditsAllowed, webBillingUrl } from './availability'

const SUCCESS_VISIBLE_MS = 6_000

// Under the usage limits key, so the realtime `billing` scope and App Store changes refresh them too.
export const creditSummaryKey = (namespace: string) => ['usage-limits', namespace, 'credits'] as const
export const signupPromoKey = (namespace: string) => ['usage-limits', namespace, 'signup-promo'] as const

export function creditSummaryQuery(namespace: string) {
  return queryOptions({ queryKey: creditSummaryKey(namespace), queryFn: () => mobileApi.creditSummary() })
}

export function signupPromoQuery(namespace: string) {
  return queryOptions({ queryKey: signupPromoKey(namespace), queryFn: () => mobileApi.signupPromo(), staleTime: 60_000 })
}

function useNamespace(): string {
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const userId = useSessionStore((state) => state.user?.id)
  return userId ? cacheNamespace(instanceUrl, userId) : ''
}

/** Whether this build may show credits for the signed-in account; see `creditsAllowed`. */
export function useCreditsAvailable(): boolean {
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const signedIn = useSessionStore((state) => Boolean(state.user))
  const capability = useSessionStore((state) => state.config?.capabilities.credits)
  // Builds from before the storefront check have no `storefront` and never show credits.
  const eligible = Boolean(Platform.OS === 'ios' && typeof storeKit?.storefront === 'function' && signedIn && capability && appStoreHostAllowed(instanceUrl))
  const storefront = useQuery({
    queryKey: ['app-store-storefront'],
    queryFn: async () => (await storeKit?.storefront()) ?? null,
    enabled: eligible,
    // The Apple Account's country can change while the app runs; StoreKit caches it locally.
    staleTime: 5 * 60_000,
    networkMode: 'always',
  })
  if (!eligible) return false
  return creditsAllowed({ platform: Platform.OS, instanceUrl, capability, storefront: storefront.data })
}

/** The balance and payments, refreshed when the app returns from adding credits on the web. */
export function useCreditSummary(enabled: boolean) {
  const namespace = useNamespace()
  const query = useQuery({ ...creditSummaryQuery(namespace), enabled: enabled && Boolean(namespace) })
  const { refetch } = query
  const active = enabled && Boolean(namespace)
  useEffect(() => {
    if (!active) return
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void refetch() })
    return () => subscription.remove()
  }, [active, refetch])
  return query
}

export function useSignupPromoOffer(enabled: boolean) {
  const namespace = useNamespace()
  return useQuery({ ...signupPromoQuery(namespace), enabled: enabled && Boolean(namespace) })
}

/** Claims the signup promo, keeping a short confirmation once the offer itself is gone. */
export function useSignupPromoClaim() {
  const namespace = useNamespace()
  const queryClient = useQueryClient()
  const [claiming, setClaiming] = useState(false)
  const [claimedMicros, setClaimedMicros] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (claimedMicros === null) return
    const timer = setTimeout(() => setClaimedMicros(null), SUCCESS_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [claimedMicros])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['usage-limits', namespace] })
  const claim = async () => {
    if (claiming) return
    setClaiming(true)
    setError('')
    try {
      const result = await mobileApi.claimSignupPromo()
      setClaimedMicros(result.amountMicros)
    } catch (caught) {
      // A used-up budget shows on the refreshed offer; other failures can be retried.
      if (!(caught instanceof ApiError && caught.code === 'signup_promo_budget_exhausted')) setError('Couldn’t claim the credits. Try again.')
    } finally {
      setClaiming(false)
      void refresh()
    }
  }
  return { claim, claiming, claimedMicros, error }
}

/** Opens Billing on the web in the browser, where credits are bought. */
export function useOpenWebBilling() {
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  return (options: { addCredits?: boolean } = {}) => Linking.openURL(webBillingUrl(instanceUrl, options))
}
