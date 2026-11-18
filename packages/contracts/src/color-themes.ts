import { z } from 'zod'

/**
 * Pulpo color themes use VS Code's color theme format: each appearance is a VS Code theme's
 * `colors` (workbench color ids) and `tokenColors` (TextMate rules). Only the ids Pulpo renders are
 * kept. Ids under `pulpo.` are Pulpo's own, the way extensions contribute colors; VS Code ignores them.
 */
export const THEME_COLOR_KEYS = [
  'editor.background',
  'editorWidget.background',
  'button.secondaryBackground',
  'list.hoverBackground',
  'foreground',
  'descriptionForeground',
  'panel.border',
  'input.border',
  'button.background',
  'button.foreground',
  'focusBorder',
  'chat.requestBackground',
  'textCodeBlock.background',
  'sideBar.background',
  'list.activeSelectionBackground',
  'sideBar.border',
  'errorForeground',
  'diffEditor.insertedTextBackground',
  'diffEditor.removedTextBackground',
  'pulpo.temporaryChatBackground',
  'pulpo.temporaryChatSurface',
  'pulpo.temporaryChatBorder',
  'pulpo.temporaryChatForeground',
  'pulpo.temporaryChatToggleForeground',
  'pulpo.expiringChatForeground',
  'pulpo.planForeground',
] as const
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number]

export const THEME_APPEARANCES = ['light', 'dark'] as const
export type ThemeAppearance = (typeof THEME_APPEARANCES)[number]

export const THEME_NAME_MAX_LENGTH = 60
export const THEME_CSS_MAX_LENGTH = 16_000
export const THEME_TOKEN_RULES_MAX = 40
export const CUSTOM_THEMES_MAX = 20
export const DEFAULT_COLOR_THEME_ID = 'pulpo'

const themeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
/** `#rrggbb` or `#rrggbbaa`, as VS Code themes write them. */
export const themeColorValueSchema = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).transform((value) => value.toLowerCase())
const themeColorKeySchema = z.enum(THEME_COLOR_KEYS)

const themeColorsSchema = z.preprocess(
  (value) => (value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([key]) => themeColorKeySchema.safeParse(key).success))
    : value),
  z.partialRecord(themeColorKeySchema, themeColorValueSchema),
)
export type ThemeColors = Partial<Record<ThemeColorKey, string>>

const scopeSchema = z.string().trim().min(1).max(200)
export const themeTokenRuleSchema = z.object({
  name: z.string().max(100).optional(),
  scope: z.union([scopeSchema, z.array(scopeSchema).min(1).max(30)]),
  settings: z.object({
    foreground: themeColorValueSchema.optional(),
    fontStyle: z.string().max(40).optional(),
  }),
})
export type ThemeTokenRule = z.infer<typeof themeTokenRuleSchema>

/** One appearance of a theme: the subset of a VS Code color theme that Pulpo uses. */
export const themeVariantSchema = z.object({
  colors: themeColorsSchema.default({}),
  tokenColors: z.array(themeTokenRuleSchema).max(THEME_TOKEN_RULES_MAX).default([]),
})
export type ThemeVariant = z.infer<typeof themeVariantSchema>

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
  // Comments are scanned too. They can't form tokens (`url/**/(` is not a url() call), so leaving
  // them in can only over-refuse, while stripping them has let escapes and strings hide real rules.
  const source = decodeCssEscapes(css).toLowerCase()
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

export const themeCssSchema = z.string().max(THEME_CSS_MAX_LENGTH).default('').superRefine((css, context) => {
  const reason = unsafeThemeCssReason(css)
  if (reason) context.addIssue({ code: 'custom', message: reason })
})

export const customThemeSchema = z.object({
  id: themeIdSchema,
  name: z.string().trim().min(1).max(THEME_NAME_MAX_LENGTH),
  light: themeVariantSchema.default(() => ({ colors: {}, tokenColors: [] })),
  dark: themeVariantSchema.default(() => ({ colors: {}, tokenColors: [] })),
  css: themeCssSchema,
})
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

/**
 * What Pulpo adds to an exported VS Code theme so it can be imported back whole: both appearances
 * and the custom CSS. VS Code ignores unknown top-level properties.
 */
export const pulpoThemeExtensionSchema = z.object({
  version: z.literal(1),
  light: themeVariantSchema.optional(),
  dark: themeVariantSchema.optional(),
  css: themeCssSchema.optional(),
})
export type PulpoThemeExtension = z.infer<typeof pulpoThemeExtensionSchema>
