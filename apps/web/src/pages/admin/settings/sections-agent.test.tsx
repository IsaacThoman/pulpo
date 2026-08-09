import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WebToolsSettings } from '@pulpo/contracts'
import { AgentSection } from './sections-agent'
import { moveWebProvider, webToolsPatchBody } from './web-tools-form'

describe('agent web-tool settings', () => {
  it('renders global web settings before both provider sections', () => {
    const markup = renderToStaticMarkup(<AgentSection />)
    expect(markup.indexOf('Web tools')).toBeGreaterThan(-1)
    expect(markup.indexOf('Web tools')).toBeLessThan(markup.indexOf('Kagi'))
    expect(markup.indexOf('Kagi')).toBeLessThan(markup.indexOf('Firecrawl'))
    expect(markup).toContain('Search fallback order')
    expect(markup).toContain('Extraction fallback order')
  })

  it('reorders providers without mutating the original value', () => {
    const original = ['kagi', 'firecrawl'] as const
    expect(moveWebProvider([...original], 0, 1)).toEqual(['firecrawl', 'kagi'])
    expect(original).toEqual(['kagi', 'firecrawl'])
  })

  it('builds a safe settings payload with replacement secrets only', () => {
    const settings: WebToolsSettings = {
      searchEnabled: true,
      extractEnabled: true,
      billSearches: false,
      billExtracts: false,
      searchPriceMicros: 12_000,
      extractPriceMicros: 4_000,
      searchProviderOrder: ['kagi', 'firecrawl'],
      extractProviderOrder: ['firecrawl', 'kagi'],
      kagi: { searchEnabled: true, extractEnabled: true },
      firecrawl: {
        searchEnabled: true,
        extractEnabled: true,
        baseUrl: 'https://api.firecrawl.dev/v2',
        maxAgeSeconds: 0,
        costPerCreditMicros: 100,
      },
    }
    const body = webToolsPatchBody({
      ...settings,
      kagi: { ...settings.kagi, hasApiKey: true },
      firecrawl: { ...settings.firecrawl, hasApiKey: false },
    }, '', 'new-firecrawl-key')
    expect(body.kagi).not.toHaveProperty('hasApiKey')
    expect(body.firecrawl).not.toHaveProperty('hasApiKey')
    expect(body.kagiApiKey).toBeUndefined()
    expect(body.firecrawlApiKey).toBe('new-firecrawl-key')
  })
})
