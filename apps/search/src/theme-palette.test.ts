import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultSearchPalette } from './theme-palette'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

function tokens(selector: string) {
  const start = css.indexOf(selector)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  const body = css.slice(start + selector.length, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]))
}

describe('Search default palette', () => {
  it('matches Pulpo’s default theme in every static color-scheme block', () => {
    expect(tokens(':root {')).toMatchObject(defaultSearchPalette('light'))
    expect(tokens(':root[data-theme="dark"] {')).toMatchObject(defaultSearchPalette('dark'))
    expect(tokens(':root:not([data-theme="light"]) {')).toMatchObject(defaultSearchPalette('dark'))
  })
})
