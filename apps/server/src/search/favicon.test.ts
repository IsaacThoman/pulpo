import { describe, expect, it, vi } from 'vitest'
import { createSearchFaviconFetcher } from './favicon.js'

const gstatic = (host: string) => 'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://' + host + '&size=32'
const ddg = (host: string) => 'https://icons.duckduckgo.com/ip3/' + host + '.ico'
const png = (bytes = 4) => new Response(new Uint8Array(bytes).fill(1), { headers: { 'content-type': 'image/png' } })
const ico = () => new Response(new Uint8Array([0, 0, 1, 0]), { headers: { 'content-type': 'image/x-icon' } })
const notFound = () => new Response(new Uint8Array(8), { status: 404, headers: { 'content-type': 'image/png' } })

describe('Search favicon proxy', () => {
  it('serves the gstatic icon without asking DuckDuckGo', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => png())
    const icon = await createSearchFaviconFetcher(fetcher)('github.com')
    expect(icon).toEqual({ type: 'image/png', data: Buffer.from([1, 1, 1, 1]) })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(gstatic('github.com'), expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }))
  })

  it('falls back to DuckDuckGo when gstatic 404s with its default globe', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(notFound()).mockResolvedValueOnce(ico())
    const icon = await createSearchFaviconFetcher(fetcher)('vantage.sh')
    expect(icon?.type).toBe('image/x-icon')
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([gstatic('vantage.sh'), ddg('vantage.sh')])
  })

  it('treats oversized and unsafe icons as misses rather than errors', async () => {
    const declared = new Response(new Uint8Array(4), { headers: { 'content-type': 'image/png', 'content-length': '115000' } })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(declared).mockResolvedValueOnce(ico())
    expect((await createSearchFaviconFetcher(fetcher)('cursor.com'))?.type).toBe('image/x-icon')

    const streamed = vi.fn<typeof fetch>().mockResolvedValueOnce(png(65537)).mockResolvedValueOnce(ico())
    expect((await createSearchFaviconFetcher(streamed)('cursor.com'))?.type).toBe('image/x-icon')

    const svg = vi.fn<typeof fetch>(async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))
    expect(await createSearchFaviconFetcher(svg)('wikipedia.org')).toBeNull()
    expect(svg).toHaveBeenCalledTimes(2)
  })

  it('returns null when both sources miss and caches the miss for an hour', async () => {
    let now = 0
    const fetcher = vi.fn<typeof fetch>(async () => notFound())
    const lookup = createSearchFaviconFetcher(fetcher, () => now)
    expect(await lookup('mem0.ai')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
    now += 59 * 60 * 1000
    expect(await lookup('mem0.ai')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
    now += 2 * 60 * 1000
    await lookup('mem0.ai')
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('retries sooner after a timeout or network error', async () => {
    let now = 0
    const fetcher = vi.fn<typeof fetch>(async () => { throw new DOMException('timed out', 'TimeoutError') })
    const lookup = createSearchFaviconFetcher(fetcher, () => now)
    expect(await lookup('slow.example.com')).toBeNull()
    now += 6 * 60 * 1000
    fetcher.mockImplementation(async () => png())
    expect(await lookup('slow.example.com')).not.toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('serves cached hits for a day without refetching', async () => {
    let now = 0
    const fetcher = vi.fn<typeof fetch>(async () => png())
    const lookup = createSearchFaviconFetcher(fetcher, () => now)
    const first = await lookup('github.com')
    now += 23 * 60 * 60 * 1000
    expect(await lookup('github.com')).toBe(first)
    expect(fetcher).toHaveBeenCalledTimes(1)
    now += 2 * 60 * 60 * 1000
    await lookup('github.com')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('shares one upstream fetch between concurrent requests for a host', async () => {
    let release!: (response: Response) => void
    const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve }))
    const lookup = createSearchFaviconFetcher(fetcher)
    const requests = Array.from({ length: 5 }, () => lookup('github.com'))
    await Promise.resolve()
    release(png())
    const icons = await Promise.all(requests)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(new Set(icons).size).toBe(1)
    expect(icons[0]).not.toBeNull()
  })

  it('evicts the least recently used hosts once the cache is full', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => png())
    const lookup = createSearchFaviconFetcher(fetcher)
    await lookup('host0.com')
    for (let index = 1; index < 2000; index++) await lookup('host' + index + '.com')
    await lookup('host0.com')
    await lookup('overflow.com')
    expect(fetcher).toHaveBeenCalledTimes(2001)
    await lookup('host0.com')
    expect(fetcher).toHaveBeenCalledTimes(2001)
    await lookup('host1.com')
    expect(fetcher).toHaveBeenCalledTimes(2002)
  })

  it('rejects private and malformed hosts without fetching', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const lookup = createSearchFaviconFetcher(fetcher)
    for (const host of ['private.local', 'node.tailnet.ts.net', 'localhost', '127.0.0.1', 'a..b.com', 'GitHub.com', 'evil.com/path']) {
      expect(await lookup(host)).toBeNull()
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
})
