import { describe, expect, it } from 'vitest'
import {
  CUSTOM_THEMES_MAX,
  customThemesSchema,
  managementAccountSettingsSchema,
  themeFileSchema,
  unsafeThemeCssReason,
} from './index.js'

describe('color themes', () => {
  it('normalizes colors and drops roles it does not know', () => {
    const [theme] = customThemesSchema.parse([{
      id: 'custom-1',
      name: ' Iris copy ',
      dark: { background: '#1D1929', futureRole: '#ffffff' },
    }])
    expect(theme).toEqual({ id: 'custom-1', name: 'Iris copy', light: {}, dark: { background: '#1d1929' }, css: '' })
  })

  it('rejects invalid colors, duplicate ids, and too many themes', () => {
    expect(customThemesSchema.safeParse([{ id: 'a', name: 'A', light: { text: 'red' } }]).success).toBe(false)
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
  })

  it('reads exported theme files', () => {
    expect(themeFileSchema.parse({ kind: 'pulpo-theme', version: 1, name: 'Iris', dark: { action: '#F099D8' } }))
      .toEqual({ kind: 'pulpo-theme', version: 1, name: 'Iris', light: {}, dark: { action: '#f099d8' }, css: '' })
    expect(themeFileSchema.safeParse({ kind: 'other', version: 1, name: 'Iris' }).success).toBe(false)
  })

  it('keeps themes in management account settings', () => {
    const account = managementAccountSettingsSchema.parse({ username: 'pulpo_user' })
    expect(account).toMatchObject({ colorTheme: 'pulpo', customThemes: [] })
    expect(managementAccountSettingsSchema.parse({
      username: 'pulpo_user',
      colorTheme: 'custom-1',
      customThemes: [{ id: 'custom-1', name: 'Mine', dark: { background: '#000000' } }],
    }).customThemes).toHaveLength(1)
  })
})
