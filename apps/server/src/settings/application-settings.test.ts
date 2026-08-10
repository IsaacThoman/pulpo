import { describe, expect, it } from 'vitest'
import { DEFAULT_OCR_SYSTEM_PROMPT } from '@pulpo/contracts'
import { DEFAULT_BALANCE_MICROS, DEFAULT_MAX_ATTACHMENT_BYTES, DEFAULT_STORAGE_LIMIT_BYTES, DEFAULT_SUGGESTED_PROMPTS, DEFAULT_TITLE_PROMPT, parseAgentSettings, parseAuthSettings, parseInterfaceSettings, parseOcrSettings, parseWebToolsSettings, publicWebToolsSettings } from './application-settings.js'

describe('authentication application settings', () => {
  it('defaults new-user balances to five dollars', () => {
    expect(parseAuthSettings(undefined).defaultBalanceMicros).toBe(DEFAULT_BALANCE_MICROS)
  })

  it('fills the balance default for settings saved by older Pulpo versions', () => {
    const settings = parseAuthSettings({ signupEnabled: false })
    expect(settings.defaultBalanceMicros).toBe(DEFAULT_BALANCE_MICROS)
    expect(settings.defaultStorageLimitBytes).toBe(DEFAULT_STORAGE_LIMIT_BYTES)
    expect(settings.maxAttachmentBytes).toBe(DEFAULT_MAX_ATTACHMENT_BYTES)
  })

  it('accepts an instance attachment limit override', () => {
    expect(parseAuthSettings({ maxAttachmentBytes: 50 * 1024 * 1024 }).maxAttachmentBytes).toBe(50 * 1024 * 1024)
  })
})

describe('OCR application settings', () => {
  it('uses the shared Pulpo Proxy prompt by default', () => {
    const settings = parseOcrSettings(undefined)
    expect(settings.systemPrompt).toBe(DEFAULT_OCR_SYSTEM_PROMPT)
    expect(settings.modelId).toBeNull()
  })

  it('adds a catalog model slot to legacy provider settings', () => {
    const settings = parseOcrSettings({
      providerMode: 'existing',
      providerConnectionId: '123e4567-e89b-42d3-a456-426614174000',
      model: 'legacy-vision-model',
    })
    expect(settings.modelId).toBeNull()
    expect(settings.model).toBe('legacy-vision-model')
  })
})

describe('agent application settings', () => {
  it('is disabled by default with bounded execution limits', () => {
    const settings = parseAgentSettings(undefined)
    expect(settings.enabled).toBe(false)
    expect(settings.generationConcurrency).toBe(8)
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

  it('accepts a bounded generation concurrency override', () => {
    expect(parseAgentSettings({ generationConcurrency: 16 }).generationConcurrency).toBe(16)
    expect(parseAgentSettings({ generationConcurrency: 101 }).generationConcurrency).toBe(8)
  })
})

describe('web tool application settings', () => {
  it('defaults tools and user billing to disabled', () => {
    expect(parseWebToolsSettings(undefined)).toMatchObject({
      searchEnabled: false,
      extractEnabled: false,
      searchProviderOrder: ['kagi', 'firecrawl'],
      extractProviderOrder: ['kagi', 'firecrawl'],
      kagi: {
        searchEnabled: true,
        billSearches: false,
        searchPriceMicros: 12_000,
        extractEnabled: true,
        billExtracts: false,
        extractPriceMicros: 4_000,
      },
      firecrawl: {
        searchEnabled: false,
        billSearches: false,
        searchPriceMicros: 12_000,
        extractEnabled: false,
        billExtracts: false,
        extractPriceMicros: 4_000,
        baseUrl: 'https://api.firecrawl.dev/v2',
        maxAgeSeconds: 0,
      },
      encryptedKagiApiKey: null,
      encryptedFirecrawlApiKey: null,
    })
  })

  it('copies legacy global billing into both providers without overriding provider values', () => {
    expect(parseWebToolsSettings({
      billSearches: true,
      billExtracts: true,
      searchPriceMicros: 21_000,
      extractPriceMicros: 8_000,
      kagi: { billSearches: false, searchPriceMicros: 9_000 },
    })).toMatchObject({
      kagi: { billSearches: false, searchPriceMicros: 9_000, billExtracts: true, extractPriceMicros: 8_000 },
      firecrawl: { billSearches: true, searchPriceMicros: 21_000, billExtracts: true, extractPriceMicros: 8_000 },
    })
  })

  it('maps the legacy Kagi secret while adding provider defaults', () => {
    expect(parseWebToolsSettings({ searchEnabled: true, encryptedApiKey: 'encrypted-legacy' })).toMatchObject({
      searchEnabled: true,
      kagi: { searchEnabled: true, extractEnabled: true },
      firecrawl: { searchEnabled: false, extractEnabled: false },
      encryptedKagiApiKey: 'encrypted-legacy',
      encryptedFirecrawlApiKey: null,
    })
  })

  it('reports configured secrets without exposing encrypted values', () => {
    const output = publicWebToolsSettings(parseWebToolsSettings({
      encryptedKagiApiKey: 'encrypted-kagi', encryptedFirecrawlApiKey: 'encrypted-firecrawl',
    }))
    expect(output.kagi.hasApiKey).toBe(true)
    expect(output.firecrawl.hasApiKey).toBe(true)
    expect(JSON.stringify(output)).not.toContain('encrypted-kagi')
    expect(JSON.stringify(output)).not.toContain('encrypted-firecrawl')
  })
})

describe('interface application settings', () => {
  it('defaults suggested prompts to the built-in starter set', () => {
    const settings = parseInterfaceSettings(undefined)
    expect(settings.localTask).toBe('current')
    expect(settings.suggestedPromptsEnabled).toBe(true)
    expect(settings.suggestedPromptsCount).toBe(4)
    expect(settings.suggestedPrompts).toEqual([...DEFAULT_SUGGESTED_PROMPTS])
    expect(settings.titlePrompt).toBe(DEFAULT_TITLE_PROMPT)
    expect(settings.titleIncludeFirstCharacters).toBe(8_000)
    expect(settings.titleIncludeLastCharacters).toBe(8_000)
  })

  it('fills suggested prompt defaults for settings saved by older Pulpo versions', () => {
    const settings = parseInterfaceSettings({ compaction: false, compactionTokens: 12_000, title: true })
    expect(settings).not.toHaveProperty('compaction')
    expect(settings).not.toHaveProperty('compactionTokens')
    expect(settings.suggestedPromptsEnabled).toBe(true)
    expect(settings.suggestedPrompts).toEqual([...DEFAULT_SUGGESTED_PROMPTS])
    expect(settings.titleIncludeFirstCharacters).toBe(8_000)
    expect(settings.titleIncludeLastCharacters).toBe(8_000)
  })
})
