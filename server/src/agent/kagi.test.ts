import { afterEach, describe, expect, it, vi } from 'vitest'
import { KagiClient } from './kagi.js'

afterEach(() => vi.unstubAllGlobals())

describe('Kagi client', () => {
  it('formats and limits search results for the model', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      meta: { trace: 'trace-search' },
      data: { search: [
        { title: 'One', url: 'https://one.example', snippet: 'First   result', time: '2026-08-03' },
        { title: 'Two', url: 'https://two.example', snippet: 'Second result' },
      ] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const result = await new KagiClient('secret').search({ query: 'pulpo', limit: 1, includeDomains: ['Example.com'] })
    expect(result.trace).toBe('trace-search')
    expect(result.output).toContain('[One](https://one.example)')
    expect(result.output).not.toContain('Two')
    expect(fetch).toHaveBeenCalledWith('https://kagi.com/api/v1/search', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer secret' }),
    }))
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ query: 'pulpo', limit: 1, lens: { sites_included: ['example.com'] } })
  })

  it('truncates extracted Markdown before returning it to the model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      meta: { trace: 'trace-extract' }, data: [{ url: 'https://example.com/page', markdown: 'abcdefghij' }],
    }), { status: 200 })))
    const result = await new KagiClient('secret').extract('https://example.com/page', 5)
    expect(result.output).toContain('abcde')
    expect(result.output).not.toContain('fghij')
    expect(result.output).toContain('Content truncated at 5 bytes')
  })

  it('rejects non-HTTPS extraction URLs before calling Kagi', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(new KagiClient('secret').extract('http://localhost/private', 100)).rejects.toThrow('public HTTPS URL')
    expect(fetch).not.toHaveBeenCalled()
  })
})
