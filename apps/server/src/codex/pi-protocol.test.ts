import { describe, expect, it } from 'vitest'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'

describe('pinned Pi Codex protocol', () => {
  it('exposes only the expected Codex Responses adapter and a usable catalog', () => {
    const provider = openaiCodexProvider()
    const catalog = provider.getModels()
    expect(provider.id).toBe('openai-codex')
    expect(catalog.length).toBeGreaterThan(0)
    expect(catalog.every((model) => model.api === 'openai-codex-responses')).toBe(true)
    expect(catalog.every((model) => model.contextWindow > 0 && model.maxTokens > 0)).toBe(true)
    expect(catalog.every((model) => getSupportedThinkingLevels(model).includes('medium'))).toBe(true)
  })

  it('keeps the catalog identifiers unique for managed reconciliation', () => {
    const ids = openaiCodexProvider().getModels().map((model) => model.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('gpt-5.4')
  })
})
