import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchQuickAnswer } from './quick-answer.js'

afterEach(() => vi.unstubAllGlobals())

const citation = { url: 'https://docs.python.org/3/library/tomllib.html', title: 'Python docs', snippet: 'The TOML parser' }

describe('Kagi FastGPT', () => {
  it('sends only the query with Bot authorization and normalizes answer text and safe citations', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({
      meta: { id: 'private-request-id' }, data: {
        output: '<p>Read the [Python guide](https://example.org/original).[2]</p><script>ignore this</script>\n- **TOML** is supported.[2]\n- See more.[5]',
        tokens: 77,
        references: [
          { ...citation, url: 'http://127.0.0.1/' },
          { ...citation, title: '<b>Python docs</b>', snippet: 'The **TOML** parser' },
          { ...citation, url: 'https://user:secret@example.org/' },
          { ...citation, url: 'javascript:alert(1)' },
          { url: 'https://example.org/guide' },
          { ...citation, url: 'https://example.org:8080/' },
        ],
      },
    }))
    vi.stubGlobal('fetch', fetch)
    await expect(searchQuickAnswer('What does tomllib do?', 'test-bot-key')).resolves.toEqual({
      provider: 'kagi', answer: 'Read the Python guide.[2]\n\n- TOML is supported.[2]\n- See more.[5]',
      references: [
        { index: 2, ...citation },
        { index: 5, url: 'https://example.org/guide' },
      ],
    })
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://kagi.com/api/v0/fastgpt', {
      method: 'POST', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { accept: 'application/json', authorization: 'Bot test-bot-key', 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'What does tomllib do?' }),
    })
  })

  it('bounds answer text and the number of upstream references inspected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ data: {
      output: 'Word '.repeat(1_800),
      references: Array.from({ length: 30 }, (_, index) => ({ url: `https://example.org/${index}`, title: 'Title '.repeat(120) })),
    } })))
    const result = await searchQuickAnswer('question', 'test-bot-key')
    expect(result.answer.length).toBeLessThanOrEqual(4_000)
    expect(result.answer).toMatch(/…$/)
    expect(result.references).toHaveLength(12)
    expect(result.references.at(-1)?.index).toBe(12)
    expect(result.references.at(-1)?.title?.length).toBeLessThanOrEqual(180)
  })

  it.each([
    { data: { output: 'An answer', references: [{ url: 'http://private.internal/' }] } },
    { data: { output: '', references: [citation] } },
    { data: { output: 'An answer', references: [citation] }, error: [{ msg: 'private upstream error' }] },
    { data: { output: 'An answer', references: 'private upstream error' } },
  ])('rejects unavailable sourced answers without including upstream data', async payload => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(payload)))
    await expect(searchQuickAnswer('question', 'test-bot-key')).rejects.toThrow(/^Quick Answer has no sourced answer$|^Unexpected Quick Answer response$/)
  })

  it('rejects unsuccessful, oversized and invalid bodies without retrying', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('private upstream error', { status: 403 }))
      .mockResolvedValueOnce(new Response('x'.repeat(128 * 1024 + 1)))
      .mockResolvedValueOnce(new Response('small body', { headers: { 'content-length': String(128 * 1024 + 1) } }))
      .mockResolvedValueOnce(new Response('private upstream parse failure'))
    vi.stubGlobal('fetch', fetch)
    await expect(searchQuickAnswer('question', 'test-bot-key')).rejects.toThrow('Quick Answer response unavailable')
    await expect(searchQuickAnswer('question', 'test-bot-key')).rejects.toThrow('Quick Answer response exceeds the size limit')
    await expect(searchQuickAnswer('question', 'test-bot-key')).rejects.toThrow('Quick Answer response unavailable')
    await expect(searchQuickAnswer('question', 'test-bot-key')).rejects.toThrow('Unexpected Quick Answer response')
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('combines caller cancellation with a nonzero request deadline', async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetch)
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const controller = new AbortController()
    try {
      const answer = searchQuickAnswer('question', 'test-bot-key', controller.signal)
      expect(timeout).toHaveBeenCalledWith(15_000)
      controller.abort()
      await expect(answer).rejects.toMatchObject({ name: 'AbortError' })
      await expect(searchQuickAnswer('question', 'test-bot-key', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      timeout.mockRestore()
    }
  })
})
