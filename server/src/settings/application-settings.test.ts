import { describe, expect, it } from 'vitest'
import { DEFAULT_BALANCE_MICROS, DEFAULT_SUGGESTED_PROMPTS, parseAuthSettings, parseInterfaceSettings } from './application-settings.js'

describe('authentication application settings', () => {
  it('defaults new-user balances to five dollars', () => {
    expect(parseAuthSettings(undefined).defaultBalanceMicros).toBe(DEFAULT_BALANCE_MICROS)
  })

  it('fills the balance default for settings saved by older Pulpo versions', () => {
    expect(parseAuthSettings({ signupEnabled: false }).defaultBalanceMicros).toBe(DEFAULT_BALANCE_MICROS)
  })
})

describe('interface application settings', () => {
  it('defaults suggested prompts to the built-in starter set', () => {
    const settings = parseInterfaceSettings(undefined)
    expect(settings.suggestedPromptsEnabled).toBe(true)
    expect(settings.suggestedPromptsCount).toBe(4)
    expect(settings.suggestedPrompts).toEqual([...DEFAULT_SUGGESTED_PROMPTS])
  })

  it('fills suggested prompt defaults for settings saved by older Pulpo versions', () => {
    const settings = parseInterfaceSettings({ compaction: false, title: true })
    expect(settings.compaction).toBe(false)
    expect(settings.suggestedPromptsEnabled).toBe(true)
    expect(settings.suggestedPrompts).toEqual([...DEFAULT_SUGGESTED_PROMPTS])
  })
})
