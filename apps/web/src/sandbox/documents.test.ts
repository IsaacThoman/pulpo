import { describe, expect, it } from 'vitest'
import { svgDocument, withErrorReporter } from './documents'

describe('withErrorReporter', () => {
  it('keeps the doctype first so the page stays in standards mode', () => {
    const html = withErrorReporter('<!DOCTYPE html><html><body>Hi</body></html>', 'https://pulpo.example')
    expect(html.startsWith('<!DOCTYPE html><script>')).toBe(true)
    expect(html).toContain('"https://pulpo.example"')
    expect(html.endsWith('<html><body>Hi</body></html>')).toBe(true)
  })

  it('prepends the reporter to fragments', () => {
    expect(withErrorReporter('<h1>Hi</h1>', 'https://pulpo.example')).toMatch(/^<script>.*<\/script><h1>Hi<\/h1>$/)
  })
})

describe('svgDocument', () => {
  it('drops the XML prolog and wraps the drawing in a page', () => {
    const page = svgDocument('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"></svg>')
    expect(page).not.toContain('<?xml')
    expect(page).toContain('<body>\n<svg viewBox="0 0 1 1"></svg></body>')
  })
})
