import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReusableImagesProviderError, ReusableImagesRateLimitError, reusableImagesInput, searchReusableImages } from './reusable-images.js'

const imageId = '81d79a7a-f3c2-458d-9d5c-1b4867ef4680'
const image = {
  id: imageId,
  title: '<b>Wave &amp; shore</b>',
  url: 'https://images.example.org/woodcut.jpg',
  foreign_landing_url: 'https://archive.example.org/collection/woodcut',
  creator: 'A. Painter',
  creator_url: 'https://archive.example.org/artist/painter',
  license: 'by',
  license_version: '4.0',
  license_url: 'http://creativecommons.org/licenses/by/4.0/',
  attribution: 'Wave &amp; shore by A. Painter is licensed under CC BY 4.0.',
  width: 800,
  height: 600,
  source: 'examplearchive',
  category: 'illustration',
  thumbnail: 'https://images.example.org/thumbnail.jpg',
}

function imagePage(results: unknown[], page = 1, pageCount = 1) {
  return { result_count: results.length, page_count: pageCount, page_size: 20, page, results }
}

function mockResponse(response: Response) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Openverse reusable images', () => {
  it('requests a filtered public page and keeps creator, license, and source details', async () => {
    const fetcher = mockResponse(Response.json(imagePage([image], 2, 3)))
    const result = await searchReusableImages({
      query: '  Hokusai & woodcut  ', page: 2, license: 'commercial', category: 'illustration',
    })

    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      new URL('https://api.openverse.org/v1/images/?q=Hokusai+%26+woodcut&page=2&page_size=20&mature=false&license=by%2Cby-nd%2Cby-sa%2Ccc0%2Cpdm&category=illustration'),
      { redirect: 'error', signal: expect.any(AbortSignal), headers: { accept: 'application/json' } },
    )
    expect(result).toEqual({
      provider: 'openverse', page: 2, hasMore: true, results: [{
        id: imageId, title: 'Wave & shore', imageUrl: image.url,
        thumbnailUrl: 'https://api.openverse.org/v1/images/' + imageId + '/thumb/',
        sourceUrl: image.foreign_landing_url, license: { code: 'by', version: '4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
        creator: 'A. Painter', creatorUrl: image.creator_url,
        attribution: 'Wave & shore by A. Painter is licensed under CC BY 4.0.',
        width: 800, height: 600, source: 'examplearchive', category: 'illustration',
      }],
    })
  })

  it('handles the empty Openverse response and sends only the selected filters', async () => {
    const fetcher = mockResponse(Response.json(imagePage([], 1, 0)))
    await expect(searchReusableImages({ query: 'unknown image', license: 'public-domain' }))
      .resolves.toEqual({ provider: 'openverse', page: 1, hasMore: false, results: [] })
    const params = new URL(String(fetcher.mock.calls[0]?.[0])).searchParams
    expect(params.get('license')).toBe('cc0,pdm')
    expect(params.has('category')).toBe(false)
  })

  it('drops invalid, duplicate, and out-of-filter rows and preserves missing optional metadata', async () => {
    const thinImage = {
      id: imageId, url: image.url, foreign_landing_url: image.foreign_landing_url,
      license: 'cc0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      creator_url: 'https://name@archive.example.org/',
      width: -1, height: 120_000, category: 'photograph',
    }
    const distinct = '859e2a2e-8434-4946-80bd-0eb208d28c6e'
    mockResponse(Response.json(imagePage([
      { ...thinImage, id: distinct, url: 'http://127.0.0.1/image.png' },
      { ...thinImage, id: distinct, foreign_landing_url: 'https://archive.example.org:9000/file' },
      { ...thinImage, id: distinct, foreign_landing_url: 'https://host.localdomain/file' },
      { ...thinImage, id: distinct, license_url: 'https://creativecommons.org.example.org/publicdomain/zero/1.0/' },
      { ...thinImage, id: distinct, license_url: 'https://creativecommons.org/licenses/by/1.0/' },
      { ...thinImage, id: distinct, license_version: '4.0' },
      { ...image, id: distinct, category: 'photograph' },
      { ...thinImage, id: distinct, category: 'illustration' },
      thinImage,
      thinImage,
    ])))

    const result = await searchReusableImages({ query: 'wave', license: 'public-domain', category: 'photograph' })
    expect(result.results).toEqual([{
      id: imageId, title: 'Untitled image', imageUrl: image.url,
      thumbnailUrl: 'https://api.openverse.org/v1/images/' + imageId + '/thumb/',
      sourceUrl: image.foreign_landing_url, category: 'photograph',
      license: { code: 'cc0', version: '1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    }])
  })

  it('stops pagination at Pulpo’s browse limit', async () => {
    mockResponse(Response.json(imagePage([image], 10, 15)))
    await expect(searchReusableImages({ query: 'wave', page: 10 })).resolves.toMatchObject({ page: 10, hasMore: false })
  })

  it.each([
    { query: '   ' }, { query: 'x'.repeat(201) }, { query: 'two\nwords' }, { query: 'wave', page: 0 },
    { query: 'wave', page: 11 }, { query: 'wave', page: '2' }, { query: 'wave', license: 'unknown' },
    { query: 'wave', category: 'video' }, { query: 'wave', page_size: 100 },
  ])('rejects invalid input before fetch', async input => {
    const fetcher = mockResponse(Response.json(imagePage([])))
    expect(reusableImagesInput.safeParse(input).success).toBe(false)
    await expect(searchReusableImages(input as never)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    new Response('Unexpected response with upstream diagnostics'),
    Response.json(imagePage([], 2)),
    Response.json(imagePage(Array.from({ length: 21 }, () => image))),
  ])('rejects malformed or oversized page schemas', async response => {
    mockResponse(response)
    await expect(searchReusableImages({ query: 'wave' })).rejects.toThrow('Unexpected Openverse response')
  })

  it('bounds both advertised size and the bytes read from an actual stream', async () => {
    const cancel = vi.fn()
    const announced = new ReadableStream<Uint8Array>({ cancel })
    const fetcher = mockResponse(new Response(announced, { headers: { 'content-length': '524289' } }))
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(524_289)) },
      cancel,
    })
    fetcher.mockResolvedValueOnce(new Response(streamed))

    await expect(searchReusableImages({ query: 'wave' })).rejects.toMatchObject({ category: 'body-limit' })
    await expect(searchReusableImages({ query: 'wave' })).rejects.toMatchObject({ category: 'body-limit' })
    expect(cancel).toHaveBeenCalledTimes(2)
  })

  it('surfaces an upstream retry interval without repeating the request or showing diagnostics', async () => {
    const fetcher = mockResponse(new Response('Provider diagnostic', { status: 429, headers: { 'retry-after': '65' } }))
    const result = await searchReusableImages({ query: 'wave' }).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(ReusableImagesRateLimitError)
    expect(result).toMatchObject({ message: 'Openverse rate limit reached', retryAfterSeconds: 65 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('honors cancellation and adds a timeout to the fixed request', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const search = searchReusableImages({ query: 'wave' }, controller.signal)
    controller.abort()
    await expect(search).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    await expect(searchReusableImages({ query: 'wave' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(timeout).toHaveBeenCalledWith(20_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockResolvedValueOnce(Response.json(imagePage([])))
    await expect(searchReusableImages({ query: 'wave' })).resolves.toMatchObject({ results: [] })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('distinguishes upstream HTTP errors from connection errors without exposing provider diagnostics', async () => {
    const fetcher = mockResponse(new Response('Raw provider message', { status: 502 }))
    fetcher.mockRejectedValueOnce(new TypeError('Raw transport diagnostics'))

    const http = await searchReusableImages({ query: 'connection test' }).catch((error: unknown) => error)
    expect(http).toBeInstanceOf(ReusableImagesProviderError)
    expect(http).toMatchObject({ category: 'http', status: 502, message: 'Openverse response unavailable' })
    await expect(searchReusableImages({ query: 'connection test' })).rejects.toMatchObject({
      category: 'network', message: 'Could not reach Openverse. Try again or switch to All images.',
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('identifies its own deadline separately from caller cancellation', async () => {
    const deadline = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })))

    const pending = searchReusableImages({ query: 'deadline test' })
    deadline.abort(new DOMException('Low-level timeout', 'TimeoutError'))
    await expect(pending).rejects.toMatchObject({
      category: 'timeout', message: 'Openverse took too long to respond. Try again or switch to All images.',
    })
  })

  it('coalesces identical filters while allowing one caller to cancel independently', async () => {
    let resolveResponse!: (response: Response) => void
    const response = new Promise<Response>(resolve => { resolveResponse = resolve })
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(response)
    vi.stubGlobal('fetch', fetcher)
    const caller = new AbortController()

    const cancelled = searchReusableImages({ query: ' same image ', license: 'commercial' }, caller.signal)
    const continued = searchReusableImages({ query: 'same image', license: 'commercial', page: 1 })
    caller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)

    resolveResponse(Response.json(imagePage([image])))
    const result = await continued
    expect(result.results).toHaveLength(1)
    await expect(searchReusableImages({ query: 'same image', license: 'commercial' })).resolves.toEqual(result)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('isolates cached pages by selected filters and refreshes them after the short cache window', async () => {
    vi.useFakeTimers()
    const fetcher = mockResponse(Response.json(imagePage([image])))
    fetcher.mockResolvedValueOnce(Response.json(imagePage([{ ...image, category: 'photograph' }])))
    fetcher.mockResolvedValueOnce(Response.json(imagePage([image])))
    const query = 'separate filtered searches'

    await expect(searchReusableImages({ query, category: 'illustration' })).resolves.toMatchObject({
      results: [{ category: 'illustration' }],
    })
    await expect(searchReusableImages({ query, category: 'photograph' })).resolves.toMatchObject({
      results: [{ category: 'photograph' }],
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_001)
    await expect(searchReusableImages({ query, category: 'illustration' })).resolves.toMatchObject({
      results: [{ category: 'illustration' }],
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
