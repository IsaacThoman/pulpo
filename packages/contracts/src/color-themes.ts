import { z } from 'zod'

/**
 * Colors a theme can set, in the order the editor lists them. Each role maps to one or more of the
 * web app's CSS variables; unset roles are derived from `background`, `text`, and `action`.
 */
export const THEME_COLOR_ROLES = [
  'background',
  'surface',
  'raisedSurface',
  'hover',
  'text',
  'mutedText',
  'border',
  'input',
  'action',
  'focus',
  'messageSurface',
  'codeSurface',
  'sidebar',
  'sidebarSelection',
  'sidebarBorder',
  'error',
] as const
export type ThemeColorRole = (typeof THEME_COLOR_ROLES)[number]

/** The roles shown outside the editor's Advanced mode; every other role derives from these. */
export const THEME_BASE_COLOR_ROLES = ['background', 'text', 'action'] as const satisfies readonly ThemeColorRole[]

export const THEME_APPEARANCES = ['light', 'dark'] as const
export type ThemeAppearance = (typeof THEME_APPEARANCES)[number]

export const THEME_NAME_MAX_LENGTH = 60
export const THEME_CSS_MAX_LENGTH = 16_000
export const CUSTOM_THEMES_MAX = 20
export const DEFAULT_COLOR_THEME_ID = 'pulpo'
export const THEME_FILE_KIND = 'pulpo-theme'

const themeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const themeHexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toLowerCase())
const themeColorRoleSchema = z.enum(THEME_COLOR_ROLES)

/** Per-appearance color overrides. Unknown roles are dropped so newer theme files still import. */
export const themeColorsSchema = z.preprocess(
  (value) => (value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([role]) => themeColorRoleSchema.safeParse(role).success))
    : value),
  z.partialRecord(themeColorRoleSchema, themeHexSchema),
)
export type ThemeColors = Partial<Record<ThemeColorRole, string>>

function decodeCssEscapes(css: string): string {
  return css
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, code: string) => {
      const point = parseInt(code, 16)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '�'
    })
    .replace(/\\([^\n])/g, '$1')
}

/**
 * Why theme CSS may not be applied, or null when it is safe. Theme files are shared, so their CSS
 * must not load anything from the network: a remote `url()` or `@import` could report what's on
 * screen (attribute selectors can match input values) to someone else's server.
 */
export function unsafeThemeCssReason(css: string): string | null {
  const source = decodeCssEscapes(css).replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase()
  if (/@import\b/.test(source)) return 'Theme CSS cannot use @import.'
  if (/(^|[^\w-])(-webkit-)?image-set\s*\(|(^|[^\w-])(image|src)\s*\(/.test(source)) {
    return 'Theme CSS cannot use image(), image-set(), or src().'
  }
  for (const match of source.matchAll(/url\s*\(\s*(['"]?)\s*([^'")\s]*)/g)) {
    const target = match[2] ?? ''
    if (!target.startsWith('data:') && !target.startsWith('#')) {
      return 'Theme CSS can only use url() with data: or #id targets.'
    }
  }
  return null
}

const themeCssSchema = z.string().max(THEME_CSS_MAX_LENGTH).default('').superRefine((css, context) => {
  const reason = unsafeThemeCssReason(css)
  if (reason) context.addIssue({ code: 'custom', message: reason })
})

const themeBodySchema = z.object({
  name: z.string().trim().min(1).max(THEME_NAME_MAX_LENGTH),
  light: themeColorsSchema.default({}),
  dark: themeColorsSchema.default({}),
  css: themeCssSchema,
})

export const customThemeSchema = themeBodySchema.extend({ id: themeIdSchema })
export type CustomTheme = z.infer<typeof customThemeSchema>

export const customThemesSchema = z.array(customThemeSchema).max(CUSTOM_THEMES_MAX).superRefine((themes, context) => {
  const seen = new Set<string>()
  themes.forEach((theme, index) => {
    if (seen.has(theme.id)) context.addIssue({ code: 'custom', message: 'Theme ids must be unique', path: [index, 'id'] })
    seen.add(theme.id)
  })
})

/** The selected color theme: a built-in id or a custom theme's id. Unknown ids fall back to Pulpo. */
export const colorThemeIdSchema = themeIdSchema

/** A theme exported to a file to share or import elsewhere. */
export const themeFileSchema = themeBodySchema.extend({
  kind: z.literal(THEME_FILE_KIND),
  version: z.literal(1),
})
export type ThemeFile = z.infer<typeof themeFileSchema>
