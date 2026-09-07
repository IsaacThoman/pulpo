import { describe, expect, it } from 'vitest'
import { nativeLoginInputSchema, nativeSetupInputSchema, nativeSignupInputSchema, mobilePasskeyVerifyInputSchema, mobilePasskeyCodeExchangeInputSchema } from './index.js'

describe('native device contract compatibility', () => {
  const identity = { email: 'member@example.test', password: 'password', name: 'Member', username: 'member', deviceLabel: 'My phone' }
  it.each([nativeLoginInputSchema, nativeSetupInputSchema, nativeSignupInputSchema])('accepts old clients and retains new metadata', (schema) => {
    expect(schema.parse(identity)).not.toHaveProperty('appType')
    expect(schema.parse({ ...identity, appType: 'desktop', platform: 'windows' })).toMatchObject({ appType: 'desktop', platform: 'windows' })
    expect(schema.safeParse({ ...identity, appType: 'bogus' }).success).toBe(false)
  })
  it('retains metadata for native passkey verification and browser exchange', () => {
    const device = { deviceLabel: 'My phone', appType: 'mobile', platform: 'android' }
    const verify = { ...device, ceremonyToken: 'c'.repeat(43), response: { id: 'key', rawId: 'key', type: 'public-key', response: { clientDataJSON: 'data', authenticatorData: 'data', signature: 'sig' }, clientExtensionResults: {} } }
    expect(mobilePasskeyVerifyInputSchema.parse(verify)).toMatchObject(device)
    expect(mobilePasskeyCodeExchangeInputSchema.parse({ ...device, code: 'c'.repeat(43), codeVerifier: 'v'.repeat(43) })).toMatchObject(device)
  })
})
