import { describe, expect, it, vi } from 'vitest'
import type { WebToolsSettings } from '@pulpo/contracts'
import { createWebTools } from './web-tools.js'
import type { KagiClient } from './kagi.js'
import type { FirecrawlClient } from './firecrawl.js'

const defaults: WebToolsSettings = {
  searchEnabled: true,
  extractEnabled: true,
  searchProviderOrder: ['kagi', 'firecrawl'],
  extractProviderOrder: ['kagi', 'firecrawl'],
  kagi: {
    searchEnabled: true, billSearches: true, searchPriceMicros: 15_000,
    extractEnabled: true, billExtracts: true, extractPriceMicros: 6_000,
  },
  firecrawl: {
    searchEnabled: true, billSearches: true, searchPriceMicros: 25_000,
    extractEnabled: true, billExtracts: true, extractPriceMicros: 9_000,
    baseUrl: 'https://api.firecrawl.dev/v2',
    maxAgeSeconds: 0,
  },
}

describe('web provider agent tools', () => {
  it('only exposes globally enabled tools with a usable provider', () => {
    const clients = { kagi: {} as KagiClient }
    expect(createWebTools({ clients, settings: { ...defaults, extractEnabled: false }, maxOutputBytes: 1000 }).map((tool) => tool.name)).toEqual(['web_search'])
    expect(createWebTools({ clients: {}, settings: defaults, maxOutputBytes: 1000 })).toEqual([])
  })

  it('reserves and bills the successful provider search price', async () => {
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
    const reserve = vi.fn()
    const firecrawlSearch = vi.fn().mockResolvedValue({ output: 'fallback results', requestId: 'fc-1' })
    const [tool] = createWebTools({
      clients: {
        kagi: { search: kagiSearch } as unknown as KagiClient,
        firecrawl: { search: firecrawlSearch } as unknown as FirecrawlClient,
      },
      settings: defaults,
      maxOutputBytes: 1000,
      onProviderAttempts: completed,
      reserveBillableCost: reserve,
    })
    const result = await tool!.execute('search-2', { query: 'new page' })
    expect(result.content).toEqual([{ type: 'text', text: 'fallback results' }])
    expect(result.details).toMatchObject({
      provider: 'firecrawl',
      providerCostMicros: 12_000,
      billedCostMicros: 25_000,
      providerAttempts: [
        { provider: 'kagi', outcome: 'empty', providerCostMicros: 12_000 },
        { provider: 'firecrawl', outcome: 'success', providerCostMicros: 0 },
      ],
    })
    expect(reserve.mock.calls.map(([amount]) => amount)).toEqual([15_000, 10_000])
    expect(completed).toHaveBeenCalledWith('search-2', expect.objectContaining({ provider: 'firecrawl', providerCostMicros: 12_000 }))
  })

  it('uses independent provider ordering for extraction', async () => {
    const reserve = vi.fn()
    const firecrawlExtract = vi.fn().mockResolvedValue({ output: 'page' })
    const kagiExtract = vi.fn()
    const tools = createWebTools({
      clients: {
        kagi: { extract: kagiExtract } as unknown as KagiClient,
        firecrawl: { extract: firecrawlExtract } as unknown as FirecrawlClient,
      },
      settings: { ...defaults, extractProviderOrder: ['firecrawl', 'kagi'] },
      maxOutputBytes: 1000,
      reserveBillableCost: reserve,
    })
    const result = await tools.find((tool) => tool.name === 'web_fetch')!.execute('fetch-1', { url: 'https://example.com' })
    expect(result.details).toMatchObject({ provider: 'firecrawl', billedCostMicros: 9_000 })
    expect(reserve).toHaveBeenCalledWith(9_000)
    expect(firecrawlExtract).toHaveBeenCalledWith('https://example.com', 1000, 0, undefined)
    expect(kagiExtract).not.toHaveBeenCalled()
  })

  it('bills Kagi when extraction falls back from Firecrawl', async () => {
    const reserve = vi.fn()
    const firecrawlExtract = vi.fn().mockResolvedValue({ output: '', emptyReason: 'missing content' })
    const kagiExtract = vi.fn().mockResolvedValue({ output: 'Kagi page' })
    const tools = createWebTools({
      clients: {
        kagi: { extract: kagiExtract } as unknown as KagiClient,
        firecrawl: { extract: firecrawlExtract } as unknown as FirecrawlClient,
      },
      settings: { ...defaults, extractProviderOrder: ['firecrawl', 'kagi'] },
      maxOutputBytes: 1000,
      reserveBillableCost: reserve,
    })
    const result = await tools.find((tool) => tool.name === 'web_fetch')!.execute('fetch-fallback', { url: 'https://example.com' })
    expect(result.details).toMatchObject({
      provider: 'kagi',
      billedCostMicros: 6_000,
      providerCostMicros: 4_000,
      providerAttempts: [
        { provider: 'firecrawl', outcome: 'empty', providerCostMicros: 0 },
        { provider: 'kagi', outcome: 'success', providerCostMicros: 4_000 },
      ],
    })
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(reserve).toHaveBeenCalledWith(9_000)
  })

  it('does not bill when billing is disabled for the provider that resolves the request', async () => {
    const reserve = vi.fn()
    const [tool] = createWebTools({
      clients: {
        kagi: { search: vi.fn().mockResolvedValue({ output: '', emptyReason: 'empty' }) } as unknown as KagiClient,
        firecrawl: { search: vi.fn().mockResolvedValue({ output: 'free fallback' }) } as unknown as FirecrawlClient,
      },
      settings: { ...defaults, firecrawl: { ...defaults.firecrawl, billSearches: false } },
      maxOutputBytes: 1000,
      reserveBillableCost: reserve,
    })
    const result = await tool!.execute('search-free', { query: 'free' })
    expect(result.details).toMatchObject({ provider: 'firecrawl', billedCostMicros: 0 })
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(reserve).toHaveBeenCalledWith(15_000)
  })

  it('stops before an unaffordable more expensive fallback provider', async () => {
    const insufficient = new Error('Insufficient balance for the requested web tool')
    const reserve = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(insufficient)
    const firecrawlSearch = vi.fn()
    const [tool] = createWebTools({
      clients: {
        kagi: { search: vi.fn().mockResolvedValue({ output: '', emptyReason: 'empty' }) } as unknown as KagiClient,
        firecrawl: { search: firecrawlSearch } as unknown as FirecrawlClient,
      },
      settings: defaults,
      maxOutputBytes: 1000,
      reserveBillableCost: reserve,
    })
    await expect(tool!.execute('search-expensive', { query: 'fallback' })).rejects.toThrow(insufficient)
    expect(reserve.mock.calls.map(([amount]) => amount)).toEqual([15_000, 10_000])
    expect(firecrawlSearch).not.toHaveBeenCalled()
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
