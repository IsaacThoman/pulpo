import { describe, expect, it } from 'vitest'
import { appStoreHostAllowed, appStoreOffer } from './availability'

const products = { eight: 'pulpoEight', fat: 'pulpoFat' }
const capability = { environments: ['production', 'sandbox'] as Array<'production' | 'sandbox'>, products }
const offer = (overrides: Partial<Parameters<typeof appStoreOffer>[0]>) => appStoreOffer({
  platform: 'ios', instanceUrl: 'https://pulpo.baby', capability, environment: 'production', ...overrides,
})

describe('App Store availability', () => {
  it('offers purchases only on hosted Pulpo over HTTPS', () => {
    expect(appStoreHostAllowed('https://pulpo.baby')).toBe(true)
    expect(appStoreHostAllowed('https://dev.pulpo.baby/')).toBe(true)
    expect(appStoreHostAllowed('http://pulpo.baby')).toBe(false)
    expect(appStoreHostAllowed('https://pulpo.baby.example.com')).toBe(false)
    expect(appStoreHostAllowed('https://chat.example.com')).toBe(false)
    expect(appStoreHostAllowed('not a url')).toBe(false)
  })

  it('offers the server’s products when it accepts this build’s StoreKit environment', () => {
    expect(offer({})).toEqual(products)
    expect(offer({ environment: 'sandbox', capability: { environments: ['sandbox'], products } })).toEqual(products)
  })

  it('offers nothing off iOS, off hosted Pulpo, or in an environment the server refuses', () => {
    expect(offer({ platform: 'android' })).toBeNull()
    expect(offer({ instanceUrl: 'https://chat.example.com' })).toBeNull()
    expect(offer({ capability: null })).toBeNull()
    expect(offer({ capability: { environments: ['production'] } })).toBeNull()
    expect(offer({ environment: 'sandbox', capability: { environments: ['production'], products } })).toBeNull()
    expect(offer({ environment: 'xcode' })).toBeNull()
    expect(offer({ environment: null })).toBeNull()
  })
})
