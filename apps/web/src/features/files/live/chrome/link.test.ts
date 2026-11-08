import { describe, expect, it } from 'vitest'
import { normalizeLink } from './link'

const url = (input: string, accept?: (value: string) => string | null | undefined) => {
  const result = normalizeLink(input, accept)
  return result.ok ? result.url : null
}

describe('normalizeLink', () => {
  it('adds https:// to web addresses typed without a scheme', () => {
    expect(url('example.com')).toBe('https://example.com')
    expect(url('  pulpo.baby/docs?x=1#top ')).toBe('https://pulpo.baby/docs?x=1#top')
    expect(url('www.example.co.uk')).toBe('https://www.example.co.uk')
    expect(url('localhost:3000/a')).toBe('https://localhost:3000/a')
    expect(url('example.com:8080')).toBe('https://example.com:8080')
    expect(url('192.168.1.10')).toBe('https://192.168.1.10')
    expect(url('//cdn.example.com/x')).toBe('https://cdn.example.com/x')
  })

  it('keeps http(s), mailto:, and tel: links, and makes email addresses mailto:', () => {
    expect(url('http://example.com')).toBe('http://example.com')
    expect(url('HTTPS://Example.com/Path')).toBe('HTTPS://Example.com/Path')
    expect(url('mailto:ada@example.com')).toBe('mailto:ada@example.com')
    expect(url('tel:+15551234567')).toBe('tel:+15551234567')
    expect(url('ada@example.com')).toBe('mailto:ada@example.com')
  })

  it('refuses other schemes and text that is not a link', () => {
    for (const input of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://example.com']) {
      expect(normalizeLink(input)).toEqual({ ok: false, error: 'Links can start with http://, https://, mailto:, or tel:.' })
    }
    for (const input of ['', '   ', 'hello', 'two words.com', 'http://', 'mailto:', 'https://exa mple.com']) expect(url(input)).toBeNull()
  })

  it("lets an editor take its own targets first (a sheet's cell references)", () => {
    const cells = (value: string) => /^(?:'[^']+'|[A-Za-z0-9_]+)!\$?[A-Z]{1,3}\$?\d+$/.test(value) ? value : undefined
    expect(url('Sheet1!A1', cells)).toBe('Sheet1!A1')
    expect(url("'Q3 budget'!$B$4", cells)).toBe("'Q3 budget'!$B$4")
    expect(url('example.com', cells)).toBe('https://example.com')
    expect(url('Sheet1', cells)).toBeNull()
  })
})
