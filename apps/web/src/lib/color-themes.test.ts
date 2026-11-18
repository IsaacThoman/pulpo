import { describe, expect, it } from 'vitest'
import { THEME_COLOR_ROLES } from '@pulpo/contracts'
import { contrastRatio, mixHex, normalizeHex } from './color'
import {
  BUILT_IN_THEMES,
  colorThemeStylesheet,
  findColorTheme,
  paletteVariables,
  parseThemeFile,
  resolvePalette,
  themeFileName,
  themeToFile,
} from './color-themes'

describe('color helpers', () => {
  it('normalizes hex and mixes in OKLab', () => {
    expect(normalizeHex('ABC')).toBe('#aabbcc')
    expect(normalizeHex('#12345')).toBeNull()
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
  })
})

describe('color themes', () => {
  it('ships Pulpo and the Iris colors from the reference', () => {
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual(['pulpo', 'iris', 'ocean', 'forest', 'ember'])
    const iris = findColorTheme('iris', [])
    expect(iris.dark).toMatchObject({ background: '#1d1929', action: '#f099d8', focus: '#9d7df2', messageSurface: '#4b3d72', sidebar: '#272139' })
  })

  it('leaves Pulpo to index.css', () => {
    expect(colorThemeStylesheet(findColorTheme('pulpo', []))).toBe('')
  })

  it('derives every role from the base colors, in both appearances', () => {
    for (const theme of BUILT_IN_THEMES) {
      for (const appearance of ['light', 'dark'] as const) {
        const palette = resolvePalette(theme[appearance], appearance)
        for (const role of THEME_COLOR_ROLES) expect(palette[role]).toMatch(/^#[0-9a-f]{6}$/)
        // Body text and button labels stay readable.
        expect(contrastRatio(palette.text, palette.background)).toBeGreaterThan(7)
        const variables = paletteVariables(palette)
        expect(contrastRatio(variables['--primary-foreground']!, palette.action)).toBeGreaterThan(4.5)
      }
    }
  })

  it('keeps explicit colors and lets custom CSS through only when it is safe', () => {
    const base = { id: 'custom-a', name: 'A', builtIn: false, light: { background: '#ffffff', hover: '#123456' }, dark: {} }
    expect(colorThemeStylesheet({ ...base, css: '.a { color: red }' })).toContain('--accent:#123456;')
    expect(colorThemeStylesheet({ ...base, css: '.a { color: red }' })).toMatch(/\n\.a \{ color: red \}$/)
    expect(colorThemeStylesheet({ ...base, css: '.a { background: url(https://example.com) }' })).not.toContain('example.com')
  })

  it('round-trips themes through files', () => {
    const iris = findColorTheme('iris', [])
    const file = themeToFile(iris)
    expect(themeFileName(iris)).toBe('iris.pulpo-theme.json')
    expect(parseThemeFile(JSON.stringify(file))).toEqual({ ok: true, theme: { name: 'Iris', light: iris.light, dark: iris.dark, css: '' } })
    expect(parseThemeFile('nope')).toEqual({ ok: false, reason: 'json' })
    expect(parseThemeFile('{"kind":"something-else"}')).toEqual({ ok: false, reason: 'format' })
    expect(parseThemeFile(JSON.stringify({ ...file, css: '@import "https://example.com/x.css";' }))).toMatchObject({ ok: false, reason: 'css' })
  })
})
