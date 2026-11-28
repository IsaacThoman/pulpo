import { appStoreHostAllowed } from '../app-store/availability'

/** StoreKit's country code for the United States App Store storefront (ISO 3166-1 alpha-3). */
export const US_STOREFRONT = 'USA'

/**
 * Whether the app may show credits: the balance, the signup promo, payment history, and links to
 * Billing on the web to add credits. iOS on hosted Pulpo only, with the server's `credits`
 * capability on, and only on the US App Store storefront. App Review allows links to other ways to
 * pay there (guideline 3.1.1(a)); other storefronts would need credits sold as in-app purchases.
 */
export function creditsAllowed(input: {
  platform: string
  instanceUrl: string
  capability: boolean | undefined
  storefront: string | null | undefined
}): boolean {
  const { platform, instanceUrl, capability, storefront } = input
  return platform === 'ios' && Boolean(capability) && appStoreHostAllowed(instanceUrl) && storefront === US_STOREFRONT
}

/** Billing on the web, optionally opening its Add credits dialog (`?topup=1`). */
export function webBillingUrl(instanceUrl: string, options: { addCredits?: boolean } = {}): string {
  const url = new URL('/billing', instanceUrl)
  if (options.addCredits) url.searchParams.set('topup', '1')
  return url.toString()
}
