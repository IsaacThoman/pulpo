import { readSearchHandoff, SEARCH_HANDOFF_PATH } from '@pulpo/contracts/search'
import { expect, it } from 'vitest'
import { buildAskPulpoUrl } from './ask-pulpo'

it('hands over up to five unique public result URLs in order without putting them in the request path', () => {
  const source = 'https://www.nps.gov/tide-pools?id=1#shore'
  const resultUrls = [
    'javascript:alert(1)',
    'https://secret@example.com/sign-in',
    'http://0x7f000001/link',
    'http://local-server.test/',
    'http://secret.internal/',
    'https://public.example.com:6000/',
    'https://www.nps.gov/' + 'p'.repeat(600),
    source,
    source,
    ...Array.from({ length: 7 }, (_, index) => `https://example.org/result-${index}`),
  ]
  const query = ' Tide pools near Monterey & Pacific Grove? '
  const url = new URL(buildAskPulpoUrl('https://pulpo.baby', query, resultUrls.map(url => ({ url })))!)

  expect(url.origin).toBe('https://pulpo.baby')
  expect(url.pathname).toBe(SEARCH_HANDOFF_PATH)
  expect(url.search).toBe('')
  expect(readSearchHandoff(url.hash)).toEqual({
    query: query.trim(),
    sources: [source, ...resultUrls.slice(9, 13)],
  })
})

it('omits a link without a bounded query and usable sources', () => {
  const results = [{ url: 'https://example.org' }]
  expect(buildAskPulpoUrl('https://pulpo.baby', ' ', results)).toBeUndefined()
  expect(buildAskPulpoUrl('https://pulpo.baby', 'q'.repeat(501), results)).toBeUndefined()
  expect(buildAskPulpoUrl('https://pulpo.baby', 'Mozilla', [])).toBeUndefined()
  expect(buildAskPulpoUrl('https://pulpo.baby', 'Mozilla', [{ url: 'https://private.example' }])).toBeUndefined()
})
