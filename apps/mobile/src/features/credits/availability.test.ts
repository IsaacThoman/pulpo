import { describe, expect, it } from 'vitest'
import { creditsAllowed, webBillingUrl } from './availability'

const allowed = { platform: 'ios', instanceUrl: 'https://pulpo.baby', capability: true, storefront: 'USA' }

describe('credits availability', () => {
  it('shows credits on iOS, hosted Pulpo, the US storefront, and with the server capability', () => {
    expect(creditsAllowed(allowed)).toBe(true)
    expect(creditsAllowed({ ...allowed, instanceUrl: 'https://dev.pulpo.baby/' })).toBe(true)
  })

  it('hides credits on other storefronts, or when the storefront is unknown', () => {
    expect(creditsAllowed({ ...allowed, storefront: 'GBR' })).toBe(false)
    expect(creditsAllowed({ ...allowed, storefront: null })).toBe(false)
    expect(creditsAllowed({ ...allowed, storefront: undefined })).toBe(false)
  })

  it('hides credits on Android, self-hosted instances, and servers without the capability', () => {
    expect(creditsAllowed({ ...allowed, platform: 'android' })).toBe(false)
    expect(creditsAllowed({ ...allowed, instanceUrl: 'https://chat.example.com' })).toBe(false)
    expect(creditsAllowed({ ...allowed, instanceUrl: 'http://pulpo.baby' })).toBe(false)
    expect(creditsAllowed({ ...allowed, capability: false })).toBe(false)
    expect(creditsAllowed({ ...allowed, capability: undefined })).toBe(false)
  })

  it('links to web Billing, opening Add credits when asked', () => {
    expect(webBillingUrl('https://pulpo.baby')).toBe('https://pulpo.baby/billing')
    expect(webBillingUrl('https://pulpo.baby/', { addCredits: true })).toBe('https://pulpo.baby/billing?topup=1')
  })
})
