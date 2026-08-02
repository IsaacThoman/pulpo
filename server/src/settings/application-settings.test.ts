import { describe, expect, it } from 'vitest'
import { DEFAULT_BALANCE_MICROS, DEFAULT_SUGGESTED_PROMPTS, DEFAULT_TITLE_PROMPT, parseAgentSettings, parseAuthSettings, parseInterfaceSettings } from './application-settings.js'

describe('authentication application settings', () => {
  it('defaults new-user balances to five dollars', () => {
    expect(parseAuthSettings(undefined).defaultBalanceMicros).toBe(DEFAULT_BALANCE_MICROS)
  })

  it('fills the balance default for settings saved by older Pulpo versions', () => {
    expect(parseAuthSettings({ signupEnabled: false }).defaultBalanceMicros).toBe(DEFAULT_BALANCE_MICROS)
  })
})

describe('agent application settings', () => {
  it('is disabled by default with bounded execution limits', () => {
    const settings = parseAgentSettings(undefined)
    expect(settings.enabled).toBe(false)
    expect(settings.warmCapacity).toBe(1)
    expect(settings.maxActiveWorkspaces).toBe(3)
    expect(settings.cpu).toBe('2')
    expect(settings.memory).toBe('2048Mi')
    expect(settings.ephemeralStorage).toBe('20Gi')
    expect(settings.idleTimeoutSeconds).toBe(1_800)
    expect(settings.hardTimeoutSeconds).toBe(14_400)
    expect(settings.workspaceWaitTimeoutSeconds).toBe(900)
    expect(settings.maxModelTurns).toBe(30)
    expect(settings.commandTimeoutSeconds).toBe(600)
  })

  it('normalizes legacy Gi agent memory values to MiB', () => {
    expect(parseAgentSettings({ memory: '2Gi' }).memory).toBe('2048Mi')
    expect(parseAgentSettings({ memory: '3072Mi' }).memory).toBe('3072Mi')
  })

  it('normalizes legacy Kubernetes CPU and disk quantities to the displayed units', () => {
    const settings = parseAgentSettings({ cpu: '500m', ephemeralStorage: '20480Mi' })
    expect(settings.cpu).toBe('0.5')
    expect(settings.ephemeralStorage).toBe('20Gi')
  })
})

describe('interface application settings', () => {
  it('defaults suggested prompts to the built-in starter set', () => {
    const settings = parseInterfaceSettings(undefined)
    expect(settings.suggestedPromptsEnabled).toBe(true)
    expect(settings.suggestedPromptsCount).toBe(4)
    expect(settings.suggestedPrompts).toEqual([...DEFAULT_SUGGESTED_PROMPTS])
    expect(settings.titlePrompt).toBe(DEFAULT_TITLE_PROMPT)
    expect(settings.titleIncludeFirstCharacters).toBe(8_000)
    expect(settings.titleIncludeLastCharacters).toBe(8_000)
  })

  it('fills suggested prompt defaults for settings saved by older Pulpo versions', () => {
    const settings = parseInterfaceSettings({ compaction: false, title: true })
    expect(settings.compaction).toBe(false)
    expect(settings.suggestedPromptsEnabled).toBe(true)
    expect(settings.suggestedPrompts).toEqual([...DEFAULT_SUGGESTED_PROMPTS])
    expect(settings.titleIncludeFirstCharacters).toBe(8_000)
    expect(settings.titleIncludeLastCharacters).toBe(8_000)
  })
})
