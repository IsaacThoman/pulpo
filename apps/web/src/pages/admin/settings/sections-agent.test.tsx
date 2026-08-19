import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WebToolsSettings } from '@pulpo/contracts'
import { AgentSection } from './sections-agent'
import { moveWebProvider, webToolsPatchBody } from './web-tools-form'

describe('agent web-tool settings', () => {
  it('renders workspace controller health inside the Pi agent mode section', () => {
    const markup = renderToStaticMarkup(<AgentSection />)
    expect(markup.indexOf('Pi agent mode')).toBeLessThan(markup.indexOf('Controller URL and token'))
    expect(markup.indexOf('Controller URL and token')).toBeLessThan(markup.indexOf('Web tools'))
  })

  it('renders global web settings before both provider sections', () => {
    const markup = renderToStaticMarkup(<AgentSection />)
    expect(markup.indexOf('Web tools')).toBeGreaterThan(-1)
    expect(markup.indexOf('Web tools')).toBeLessThan(markup.indexOf('Kagi'))
    expect(markup.indexOf('Kagi')).toBeLessThan(markup.indexOf('Firecrawl'))
    expect(markup).toContain('Search fallback order')
    expect(markup).toContain('Extraction fallback order')
    expect(markup.indexOf('Bill users for Kagi searches')).toBeGreaterThan(markup.indexOf('Kagi'))
    expect(markup.indexOf('Bill users for Firecrawl searches')).toBeGreaterThan(markup.indexOf('Firecrawl'))
    expect(markup).not.toContain('Effective cost per credit')
    expect(markup).toContain('Bill users for agent workspaces')
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
      searchProviderOrder: ['kagi', 'firecrawl'],
      extractProviderOrder: ['firecrawl', 'kagi'],
      kagi: {
        searchEnabled: true, billSearches: true, searchPriceMicros: 15_000,
        extractEnabled: true, billExtracts: false, extractPriceMicros: 6_000,
      },
      firecrawl: {
        searchEnabled: true, billSearches: false, searchPriceMicros: 20_000,
        extractEnabled: true, billExtracts: true, extractPriceMicros: 9_000,
        baseUrl: 'https://api.firecrawl.dev/v2',
        maxAgeSeconds: 0,
      },
    }
    const body = webToolsPatchBody({
      ...settings,
      kagi: { ...settings.kagi, hasApiKey: true },
      firecrawl: { ...settings.firecrawl, hasApiKey: false },
    }, '', 'new-firecrawl-key')
    expect(body.kagi).not.toHaveProperty('hasApiKey')
    expect(body.firecrawl).not.toHaveProperty('hasApiKey')
    expect(body).not.toHaveProperty('billSearches')
    expect(body.kagi).toMatchObject({ billSearches: true, searchPriceMicros: 15_000 })
    expect(body.firecrawl).toMatchObject({ billExtracts: true, extractPriceMicros: 9_000 })
    expect(body.kagiApiKey).toBeUndefined()
    expect(body.firecrawlApiKey).toBe('new-firecrawl-key')
  })
})
