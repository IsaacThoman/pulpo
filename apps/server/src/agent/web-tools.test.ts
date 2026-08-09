import { describe, expect, it, vi } from 'vitest'
import type { WebToolsSettings } from '@pulpo/contracts'
import { createWebTools } from './web-tools.js'
import type { KagiClient } from './kagi.js'
import type { FirecrawlClient } from './firecrawl.js'

const defaults: WebToolsSettings = {
  searchEnabled: true,
  extractEnabled: true,
  billSearches: true,
  billExtracts: true,
  searchPriceMicros: 15_000,
  extractPriceMicros: 6_000,
  searchProviderOrder: ['kagi', 'firecrawl'],
  extractProviderOrder: ['kagi', 'firecrawl'],
  kagi: { searchEnabled: true, extractEnabled: true },
  firecrawl: {
    searchEnabled: true,
    extractEnabled: true,
    baseUrl: 'https://api.firecrawl.dev/v2',
    maxAgeSeconds: 0,
    costPerCreditMicros: 500,
  },
}

describe('web provider agent tools', () => {
  it('only exposes globally enabled tools with a usable provider', () => {
    const clients = { kagi: {} as KagiClient }
    expect(createWebTools({ clients, settings: { ...defaults, extractEnabled: false }, maxOutputBytes: 1000 }).map((tool) => tool.name)).toEqual(['web_search'])
    expect(createWebTools({ clients: {}, settings: defaults, maxOutputBytes: 1000 })).toEqual([])
  })

  it('reserves the global search price once and reports the winning provider', async () => {
    const reserve = vi.fn()
    const search = vi.fn().mockResolvedValue({ output: 'results', trace: 'trace' })
    const [tool] = createWebTools({
      clients: { kagi: { search } as unknown as KagiClient },
      settings: defaults,
      maxOutputBytes: 1000,
      reserveBillableCost: reserve,
    })
    const result = await tool!.execute('search-1', { query: 'latest Pulpo' })
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(reserve).toHaveBeenCalledWith(15_000)
    expect(result.details).toMatchObject({ provider: 'kagi', providerCostMicros: 12_000, billedCostMicros: 15_000 })
  })

  it('falls back on empty output and accumulates provider costs', async () => {
    const completed = vi.fn()
    const kagiSearch = vi.fn().mockResolvedValue({ output: '', emptyReason: 'no results', trace: 'kagi-trace' })
    const firecrawlSearch = vi.fn().mockResolvedValue({ output: 'fallback results', requestId: 'fc-1', creditsUsed: 2 })
    const [tool] = createWebTools({
      clients: {
        kagi: { search: kagiSearch } as unknown as KagiClient,
        firecrawl: { search: firecrawlSearch } as unknown as FirecrawlClient,
      },
      settings: defaults,
      maxOutputBytes: 1000,
      onProviderAttempts: completed,
    })
    const result = await tool!.execute('search-2', { query: 'new page' })
    expect(result.content).toEqual([{ type: 'text', text: 'fallback results' }])
    expect(result.details).toMatchObject({
      provider: 'firecrawl',
      providerCostMicros: 13_000,
      providerAttempts: [
        { provider: 'kagi', outcome: 'empty', providerCostMicros: 12_000 },
        { provider: 'firecrawl', outcome: 'success', creditsUsed: 2, providerCostMicros: 1_000 },
      ],
    })
    expect(completed).toHaveBeenCalledWith('search-2', expect.objectContaining({ provider: 'firecrawl', providerCostMicros: 13_000 }))
  })

  it('uses independent provider ordering for extraction', async () => {
    const firecrawlExtract = vi.fn().mockResolvedValue({ output: 'page', creditsUsed: 1 })
    const kagiExtract = vi.fn()
    const tools = createWebTools({
      clients: {
        kagi: { extract: kagiExtract } as unknown as KagiClient,
        firecrawl: { extract: firecrawlExtract } as unknown as FirecrawlClient,
      },
      settings: { ...defaults, extractProviderOrder: ['firecrawl', 'kagi'] },
      maxOutputBytes: 1000,
    })
    const result = await tools.find((tool) => tool.name === 'web_fetch')!.execute('fetch-1', { url: 'https://example.com' })
    expect(result.details).toMatchObject({ provider: 'firecrawl' })
    expect(firecrawlExtract).toHaveBeenCalledWith('https://example.com', 1000, 0, undefined)
    expect(kagiExtract).not.toHaveBeenCalled()
  })

  it('stops fallback when the caller cancels', async () => {
    const controller = new AbortController()
    const kagiSearch = vi.fn().mockImplementation(async () => {
      controller.abort(new Error('cancelled'))
      throw new Error('cancelled')
    })
    const firecrawlSearch = vi.fn()
    const [tool] = createWebTools({
      clients: {
        kagi: { search: kagiSearch } as unknown as KagiClient,
        firecrawl: { search: firecrawlSearch } as unknown as FirecrawlClient,
      },
      settings: defaults,
      maxOutputBytes: 1000,
    })
    await expect(tool!.execute('search-3', { query: 'cancel' }, controller.signal)).rejects.toThrow('cancelled')
    expect(firecrawlSearch).not.toHaveBeenCalled()
  })

  it('returns one aggregate error after every provider fails', async () => {
    const completed = vi.fn()
    const [tool] = createWebTools({
      clients: {
        kagi: { search: vi.fn().mockRejectedValue(new Error('Kagi unavailable')) } as unknown as KagiClient,
        firecrawl: { search: vi.fn().mockRejectedValue(new Error('Firecrawl unavailable')) } as unknown as FirecrawlClient,
      },
      settings: defaults,
      maxOutputBytes: 1000,
      onProviderAttempts: completed,
    })
    await expect(tool!.execute('search-4', { query: 'failure' })).rejects.toThrow('All configured search providers failed')
    expect(completed).toHaveBeenCalledWith('search-4', expect.objectContaining({
      provider: undefined,
      attempts: [expect.objectContaining({ provider: 'kagi', outcome: 'error' }), expect.objectContaining({ provider: 'firecrawl', outcome: 'error' })],
    }))
  })
})
