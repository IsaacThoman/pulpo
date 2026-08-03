import { describe, expect, it, vi } from 'vitest'
import type { WebToolsSettings } from '@pulpo/contracts'
import { createWebTools } from './web-tools.js'
import type { KagiClient } from './kagi.js'

const defaults: WebToolsSettings = {
  searchEnabled: true, extractEnabled: true, billSearches: true, billExtracts: true,
  searchPriceMicros: 15_000, extractPriceMicros: 6_000,
}

describe('Kagi agent tools', () => {
  it('only exposes tools enabled by the administrator', () => {
    const tools = createWebTools({ client: {} as KagiClient, settings: { ...defaults, extractEnabled: false }, maxOutputBytes: 1000 })
    expect(tools.map((tool) => tool.name)).toEqual(['web_search'])
  })

  it('reserves configured search billing and reports cost details', async () => {
    const reserve = vi.fn()
    const search = vi.fn().mockResolvedValue({ output: 'results', trace: 'trace' })
    const [tool] = createWebTools({ client: { search } as unknown as KagiClient, settings: defaults, maxOutputBytes: 1000, reserveBillableCost: reserve })
    const result = await tool!.execute('search-1', { query: 'latest Pulpo' })
    expect(reserve).toHaveBeenCalledWith(15_000)
    expect(result.details).toMatchObject({ providerCostMicros: 12_000, billedCostMicros: 15_000, trace: 'trace' })
  })
})
