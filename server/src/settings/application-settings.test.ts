import { describe, expect, it } from 'vitest'
import { DEFAULT_BALANCE_MICROS, parseAuthSettings } from './application-settings.js'

describe('authentication application settings', () => {
  it('defaults new-user balances to five dollars', () => {
    expect(parseAuthSettings(undefined).defaultBalanceMicros).toBe(DEFAULT_BALANCE_MICROS)
  })

  it('fills the balance default for settings saved by older Pulpo versions', () => {
    expect(parseAuthSettings({ signupEnabled: false }).defaultBalanceMicros).toBe(DEFAULT_BALANCE_MICROS)
  })
})
