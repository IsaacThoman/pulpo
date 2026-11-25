import { describe, expect, it } from 'vitest'
import { faviconBackdrop } from './favicon-contrast'

describe('favicon contrast', () => {
  const darkMark = new Uint8ClampedArray([24, 24, 24, 255, 0, 0, 0, 0, 0, 0, 0, 0])
  const lightMark = new Uint8ClampedArray([245, 245, 245, 255, 0, 0, 0, 0])

  it('backs low-contrast marks with a contrasting square', () => {
    expect(faviconBackdrop(darkMark, '#101012')).toBe('#fafafa')
    expect(faviconBackdrop(lightMark, '#fff')).toBe('#18181b')
  })

  it('leaves readable marks on the page background', () => {
    expect(faviconBackdrop(darkMark, '#fff')).toBeUndefined()
    expect(faviconBackdrop(lightMark, '#101012')).toBeUndefined()
    const multicolorMark = new Uint8ClampedArray([255, 120, 0, 255, 65, 170, 255, 255, 16, 16, 18, 255])
    expect(faviconBackdrop(multicolorMark, '#101012')).toBeUndefined()
  })

  it('accounts for opacity and skips backdrops that cannot make a mark readable', () => {
    expect(faviconBackdrop(new Uint8ClampedArray([255, 255, 255, 0]), '#fff')).toBeUndefined()
    expect(faviconBackdrop(new Uint8ClampedArray([24, 24, 24, 20]), '#101012')).toBeUndefined()
  })
})
