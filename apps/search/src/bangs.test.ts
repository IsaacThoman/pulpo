import { describe, expect, it } from 'vitest'
import { firstResultQuery, resolveBang, searchBangs, validateCustomBang } from './bangs'

describe('first-result bang', () => {
  it.each(['isaac thoman !', '! isaac thoman', ' !  isaac thoman  !  '])('cleans %s', query => {
    expect(firstResultQuery(query)).toBe('isaac thoman')
  })

  it.each(['!', '! !', 'hello!', '!g hello', '"inside ! quotes"', 'C++ !important'])('preserves %s', query => {
    expect(firstResultQuery(query)).toBeNull()
  })

  it('leaves a first-result bang inside an unfinished quoted phrase alone', () => {
    expect(firstResultQuery('"literal exclamation !')).toBeNull()
    expect(firstResultQuery('"literal ! text" !')).toBe('"literal ! text"')
  })
})

describe('bangs', () => {
  it('redirects a standalone bang anywhere in a query with safely encoded terms', () => {
    expect(resolveBang('climate & !W oceans')?.url).toBe('https://en.wikipedia.org/w/index.php?search=climate%20%26%20oceans')
    expect(resolveBang('hello!w world')).toBeNull()
    expect(resolveBang('!unknown hello')).toBeNull()
  })

  it('keeps unknown and subsequent bang tokens in the destination query', () => {
    expect(resolveBang('!noop !gh fetch !g')?.url).toBe('https://github.com/search?q=!noop%20fetch%20!g')
  })

  it('redirects only unquoted named bangs and preserves the text inside quotes', () => {
    expect(resolveBang('"why !w matters"')).toBeNull()
    expect(resolveBang('"why !w matters \\')).toBeNull()
    expect(new URL(resolveBang('"why !w  matters" !w')!.url).searchParams.get('search')).toBe('"why !w  matters"')
  })

  it('finds bangs by exact shortcut first, prefix, or name', () => {
    expect(searchBangs('!g')[0]?.trigger).toBe('g')
    expect(searchBangs('duckduckgo').map(bang => bang.trigger)).toEqual(['ddg'])
  })

  it('allows a browser shortcut to override a built-in bang', () => {
    const custom = { trigger: '!G', name: 'My search', url: 'https://example.org/find/{query}?again={query}' }
    expect(validateCustomBang(custom)).toBeNull()
    expect(resolveBang('!g /a?b#c', [custom])?.url).toBe('https://example.org/find/%2Fa%3Fb%23c?again=%2Fa%3Fb%23c')
  })

  it.each([
    'javascript:alert("{query}")',
    'https://{query}.example.org/?q={query}',
    'https://user:{query}@example.org/?q={query}',
    'https://example.org/?q=static#{query}',
    'https://example.org/?q=static',
  ])('ignores unsafe or invalid custom URL %s', url => {
    const custom = { trigger: 'mine', name: 'Custom', url }
    expect(validateCustomBang(custom)).toBeTruthy()
    expect(resolveBang('test !mine', [custom])).toBeNull()
  })
})
