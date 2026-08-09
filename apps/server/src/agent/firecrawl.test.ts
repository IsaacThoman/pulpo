import { afterEach, describe, expect, it, vi } from 'vitest'
import { FirecrawlClient, FirecrawlError, firecrawlCloudRequiresApiKey } from './firecrawl.js'

afterEach(() => vi.unstubAllGlobals())

describe('Firecrawl client', () => {
  it('formats search results and maps shared filters', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      id: 'search-id',
      creditsUsed: 2,
      data: { web: [{ title: 'Result', url: 'https://docs.example/page', description: 'Useful   result' }] },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const result = await new FirecrawlClient('https://api.firecrawl.dev/v2/', 'secret').search({
      query: 'pulpo', limit: 1, includeDomains: ['Docs.Example'], excludeDomains: ['bad.example'], timeRelative: 'week',
    })
    expect(result).toMatchObject({ requestId: 'search-id', creditsUsed: 2 })
    expect(result.output).toContain('[Result](https://docs.example/page)')
    const init = fetch.mock.calls[0]![1]
    expect(fetch.mock.calls[0]![0]).toBe('https://api.firecrawl.dev/v2/search')
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret' })
    expect(JSON.parse(init.body)).toMatchObject({
      query: 'pulpo -site:bad.example', limit: 1, includeDomains: ['docs.example'], tbs: 'qdr:w', safe: true,
    })
  })

  it('supports an unauthenticated custom endpoint and fresh truncated scrapes', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      id: 'scrape-id',
      creditsUsed: 1,
      data: { markdown: 'abcdefghij', metadata: { sourceURL: 'https://example.com/final' } },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const result = await new FirecrawlClient('http://firecrawl.internal/v2').extract('https://example.com/page', 5, 0)
    expect(result.output).toContain('Source: https://example.com/final')
    expect(result.output).toContain('abcde')
    expect(result.output).not.toContain('fghij')
    expect(result.output).toContain('Content truncated at 5 bytes')
    const init = fetch.mock.calls[0]![1]
    expect(init.headers).not.toHaveProperty('authorization')
    expect(JSON.parse(init.body)).toMatchObject({
      url: 'https://example.com/page', formats: ['markdown'], onlyMainContent: true, maxAge: 0, proxy: 'auto',
    })
  })

  it('returns empty content with consumed credits for fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true, creditsUsed: 3, data: { markdown: '', metadata: { error: 'No content' } },
    }), { status: 200 })))
    await expect(new FirecrawlClient('https://api.firecrawl.dev/v2', 'secret').extract('https://example.com', 100, 60)).resolves.toMatchObject({
      output: '', creditsUsed: 3, emptyReason: 'No content',
    })
  })

  it('surfaces API errors and reported credits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false, error: 'Rate limited', creditsUsed: 1,
    }), { status: 429 })))
    const error = await new FirecrawlClient('https://api.firecrawl.dev/v2', 'secret').search({ query: 'pulpo' }).catch((cause) => cause)
    expect(error).toBeInstanceOf(FirecrawlError)
    expect(error).toMatchObject({ message: 'Rate limited', creditsUsed: 1 })
  })

  it('only requires a key for the hosted Firecrawl endpoint', () => {
    expect(firecrawlCloudRequiresApiKey('https://api.firecrawl.dev/v2')).toBe(true)
    expect(firecrawlCloudRequiresApiKey('http://firecrawl.internal/v2')).toBe(false)
  })
})
