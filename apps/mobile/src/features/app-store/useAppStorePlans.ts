import { Platform } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { cacheNamespace } from '../../data/schema'
import { useSessionStore } from '../../store/session'
import { usageLimitsQuery } from '../usage-limits/api'
import { storeKit } from './storeKit'
import { useAppStoreOffer } from './useAppStoreOffer'

/**
 * Whether the Usage screen shows `AppStorePlans` instead of its form: iOS, hosted Pulpo, and an account
 * on Pulpo Baby with no subscription or with an App Store subscription. Web subscribers and
 * administrator-set plans keep the form.
 */
export function useAppStorePlans(enabled: boolean) {
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const userId = useSessionStore((state) => state.user?.id)
  const namespace = userId ? cacheNamespace(instanceUrl, userId) : ''
  const limits = useQuery({ ...usageLimitsQuery(namespace), enabled: enabled && Boolean(namespace) })
  const offer = useAppStoreOffer()
  if (Platform.OS !== 'ios' || !enabled || !offer || !storeKit) return null
  const data = limits.data
  if (!data) return null
  const sellable = data.subscription ? data.subscription.provider === 'app_store' : data.plan === 'baby'
  if (!sellable) return null
  return { kit: storeKit, offer, limits: data, onChanged: () => limits.refetch() }
}
