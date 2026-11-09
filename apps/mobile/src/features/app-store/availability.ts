import type { MobileConfig } from '@pulpo/contracts'

/** Hosted Pulpo only: self-hosted and third-party instances never offer App Store purchases. */
const APP_STORE_HOSTS = new Set(['pulpo.baby', 'dev.pulpo.baby'])

export const TERMS_OF_USE_URL = 'https://help.pulpo.baby/terms-hosted'
export const PRIVACY_POLICY_URL = 'https://help.pulpo.baby/privacy-hosted'
export const APP_STORE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'

export interface AppStoreProductIds {
  eight: string
  fat: string
  /** Eight with a free-trial introductory offer, sold in its place when the server allows it. */
  eightTrial?: string
}

export function appStoreHostAllowed(instanceUrl: string): boolean {
  try {
    const url = new URL(instanceUrl)
    return url.protocol === 'https:' && APP_STORE_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

/**
 * The plans this build can buy from this instance, or null when it must not offer purchases: not iOS,
 * not hosted Pulpo, a server without App Store billing, or a StoreKit environment the server refuses
 * (an App Store build talking to staging, for example).
 */
export function appStoreOffer(input: {
  platform: string
  instanceUrl: string
  capability: MobileConfig['capabilities']['appStoreBilling'] | undefined
  environment: string | null | undefined
}): AppStoreProductIds | null {
  const { platform, instanceUrl, capability, environment } = input
  if (platform !== 'ios' || !capability?.products || !appStoreHostAllowed(instanceUrl)) return null
  if (environment !== 'production' && environment !== 'sandbox') return null
  return capability.environments.includes(environment) ? capability.products : null
}
