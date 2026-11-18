import { describe, expect, it } from 'vitest'
import { contrastRatio, flattenHex, mixHex, normalizeHex } from './color'
import {
  BUILT_IN_THEMES,
  colorThemeStylesheet,
  findColorTheme,
  paletteVariables,
  parseVsCodeTheme,
  resolvePalette,
  resolveSyntax,
  stripJsonc,
  THEME_ROLES,
  themeToVsCode,
  variantFromRoles,
  vsCodeThemeFileName,
  withSyntaxColor,
} from './color-themes'

/** A VS Code theme as people write them: comments, trailing commas, alpha, and extra ids. */
const NIGHT_SKY = `{
  // A dark theme
  "name": "Night Sky",
  "type": "dark",
  "colors": {
    "editor.background": "#011627",
    "editor.foreground": "#d6deeb",
    "button.background": "#7e57c2cc", /* translucent button */
    "panel.border": "#5f7e97",
    "list.hoverBackground": "#011627aa",
    "sideBar.background": "#011627",
    "activityBar.background": "#011627",
    "statusBar.background": "#011627",
  },
  "tokenColors": [
    { "settings": { "foreground": "#d6deeb" } },
    { "scope": "comment", "settings": { "foreground": "#637777", "fontStyle": "italic" } },
    { "scope": ["string", "string.quoted"], "settings": { "foreground": "#ecc48d" } },
    { "scope": "keyword.control, storage.type", "settings": { "foreground": "#c792ea" } },
    { "scope": "keyword.operator", "settings": { "foreground": "#7fdbca" } },
    { "scope": "source.js meta.function", "settings": { "foreground": "#ff0000" } },
  ],
}`

describe('color helpers', () => {
  it('normalizes hex with alpha and mixes in OKLab', () => {
    expect(normalizeHex('ABC')).toBe('#aabbcc')
    expect(normalizeHex('#abcd')).toBe('#aabbccdd')
    expect(normalizeHex('#112233ff')).toBe('#112233')
    expect(normalizeHex('#12345')).toBeNull()
    expect(flattenHex('#ffffff80', '#000000')).toBe('#808080')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
  })
})

describe('color themes', () => {
  it('ships Pulpo and the Iris colors from the reference, stored under VS Code ids', () => {
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual(['pulpo', 'iris', 'ocean', 'forest', 'ember'])
    expect(findColorTheme('iris', []).dark.colors).toMatchObject({
      'editor.background': '#1d1929', 'button.background': '#f099d8', focusBorder: '#9d7df2', 'chat.requestBackground': '#4b3d72', 'sideBar.background': '#272139',
    })
  })

  it('leaves Pulpo to index.css', () => {
    expect(colorThemeStylesheet(findColorTheme('pulpo', []))).toBe('')
  })

  it('derives every color from the base colors, in both appearances', () => {
    for (const theme of BUILT_IN_THEMES) {
      for (const appearance of ['light', 'dark'] as const) {
        const palette = resolvePalette(theme[appearance], appearance)
        for (const role of THEME_ROLES) expect(palette[role]).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/)
        expect(contrastRatio(palette.text, palette.background)).toBeGreaterThan(7)
        expect(contrastRatio(palette.actionText, palette.action)).toBeGreaterThan(4.5)
        expect(contrastRatio(palette.temporaryText, palette.temporaryBackground)).toBeGreaterThan(4.5)
      }
    }
  })

  it('applies temporary chat and code colors, and custom CSS only when safe', () => {
    const light = variantFromRoles({ background: '#ffffff', temporarySurface: '#ff000033' }, { keyword: '#123456' })
    const theme = { id: 'custom-a', name: 'A', builtIn: false, light, dark: { colors: {}, tokenColors: [] } }
    const sheet = colorThemeStylesheet({ ...theme, css: '.a { color: red }' })
    expect(sheet).toContain('--temporary-surface:#ff000033;')
    expect(sheet).toContain('--code-keyword:#123456;')
    expect(sheet).toMatch(/\n\.a \{ color: red \}$/)
    expect(colorThemeStylesheet({ ...theme, css: '.a { background: url(https://example.com) }' })).not.toContain('example.com')
    expect(paletteVariables(resolvePalette(light, 'light'), resolveSyntax(light, 'light'))['--temporary-card']).toBe('#ff000033')
  })

  it('edits one highlighting color at a time', () => {
    const variant = withSyntaxColor({ colors: {}, tokenColors: [] }, 'string', '#00ff00')
    expect(resolveSyntax(variant, 'dark').string).toBe('#00ff00')
    expect(resolveSyntax(withSyntaxColor(variant, 'string', null), 'dark').string).toBe('#a5d6ff')
  })
})

describe('VS Code themes', () => {
  it('strips comments and trailing commas but not inside strings', () => {
    expect(JSON.parse(stripJsonc('{"a": "// not a comment, }", /* x */ "b": [1, 2,],}'))).toEqual({ a: '// not a comment, }', b: [1, 2] })
    expect(JSON.parse(stripJsonc('{"colors": {"editor.background": "#000000", /* background */ }, // end\n "x": [1, // one\n ], }'))).toEqual({ colors: { 'editor.background': '#000000' }, x: [1] })
    expect(JSON.parse(stripJsonc('{"a": "say \\"/* hi */\\"", "b": "x,]"}'))).toEqual({ a: 'say "/* hi */"', b: 'x,]' })
  })

  it('imports a VS Code theme as one appearance', () => {
    const result = parseVsCodeTheme(NIGHT_SKY, 'night-sky-color-theme.json')
    expect(result).toMatchObject({ ok: true, name: 'Night Sky', appearance: 'dark', pulpo: null, partial: false })
    if (!result.ok) throw new Error('import failed')
    expect(result.variant.colors).toEqual({
      'editor.background': '#011627',
      foreground: '#d6deeb',
      'button.background': '#654aa3',
      'panel.border': '#5f7e97',
      'list.hoverBackground': '#011627aa',
      'sideBar.background': '#011627',
    })
    const syntax = resolveSyntax(result.variant, 'dark')
    expect(syntax).toMatchObject({ comment: '#637777', string: '#ecc48d', keyword: '#c792ea' })
    // Spaced selectors are skipped; unset colors keep Pulpo's.
    expect(syntax.title).toBe('#d2a8ff')
  })

  it('infers the appearance when a theme has no type, and refuses what it cannot read', () => {
    expect(parseVsCodeTheme('{"colors": {"editor.background": "#fdf6e3"}}', 'solarized-light.json')).toMatchObject({ ok: true, appearance: 'light', name: 'solarized-light' })
    expect(parseVsCodeTheme('{"include": "./base.json", "colors": {"editor.background": "#000000"}}')).toMatchObject({ ok: true, partial: true })
    expect(parseVsCodeTheme('nope')).toEqual({ ok: false, reason: 'json' })
    expect(parseVsCodeTheme('{"name": "Empty"}')).toEqual({ ok: false, reason: 'format' })
    expect(parseVsCodeTheme('PK\u0003\u0004...', 'theme.vsix')).toEqual({ ok: false, reason: 'vsix' })
  })

  it('exports a complete VS Code theme that imports back whole', () => {
    const iris = { ...findColorTheme('iris', []), css: '.a { color: red }' }
    const exported = themeToVsCode(iris, 'dark')
    expect(vsCodeThemeFileName(iris, 'dark')).toBe('iris-dark-color-theme.json')
    expect(exported).toMatchObject({ name: 'Iris', type: 'dark', colors: { 'editor.background': '#1d1929', 'button.background': '#f099d8', 'pulpo.temporaryChatBackground': expect.any(String) } })
    expect(exported.tokenColors).toHaveLength(11)
    const result = parseVsCodeTheme(JSON.stringify(exported))
    expect(result).toMatchObject({ ok: true, appearance: 'dark', pulpo: { light: iris.light, dark: iris.dark, css: '.a { color: red }' } })
    expect(parseVsCodeTheme(JSON.stringify({ ...exported, pulpo: { version: 1, css: '@import "https://example.com/x.css";' } }))).toMatchObject({ ok: false, reason: 'css' })
  })
})

describe('temporary chats', () => {
  it('stay violet in themes that do not set them, over each theme’s own background', () => {
    for (const id of ['ocean', 'forest', 'ember']) {
      const theme = findColorTheme(id, [])
      const dark = resolvePalette(theme.dark, 'dark')
      expect(dark).toMatchObject({ temporarySurface: '#2f0d6899', temporaryBorder: '#7f22fe80', temporaryText: '#c4b4ff', planText: '#a684ff' })
      expect(dark.temporaryBackground).toBe(mixHex(dark.background, '#2f0d68', 0.15))
      const light = resolvePalette(theme.light, 'light')
      expect(light).toMatchObject({ temporarySurface: '#ede9fecc', temporaryBorder: '#8e51ff80', temporaryText: '#7008e7', planText: '#7f22fe' })
    }
  })

  it('keep a theme’s own temporary colors', () => {
    const palette = resolvePalette(variantFromRoles({ temporarySurface: '#134e4acc' }), 'dark')
    expect(palette.temporarySurface).toBe('#134e4acc')
  })
})
