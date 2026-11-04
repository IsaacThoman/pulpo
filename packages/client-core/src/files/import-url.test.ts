import { describe, expect, it } from 'vitest'
import { normalizeImportUrl } from './import-url.js'

describe('normalizeImportUrl', () => {
  it('adds https:// to addresses typed without a scheme', () => {
    expect(normalizeImportUrl('  example.com/article ')).toBe('https://example.com/article')
    expect(normalizeImportUrl('www.example.com')).toBe('https://www.example.com')
  })

  it('keeps an address that names its scheme, so the server can explain what it refuses', () => {
    expect(normalizeImportUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeImportUrl('http://example.com')).toBe('http://example.com')
    expect(normalizeImportUrl('HTTPS://Example.com')).toBe('HTTPS://Example.com')
  })

  it('leaves an empty address empty', () => {
    expect(normalizeImportUrl('   ')).toBe('')
  })
})
