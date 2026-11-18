import {
  DEFAULT_COLOR_THEME_ID,
  THEME_COLOR_ROLES,
  THEME_FILE_KIND,
  themeFileSchema,
  unsafeThemeCssReason,
  type CustomTheme,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeFile,
} from '@pulpo/contracts'
import { lightness, mixHex, mostReadable } from './color'

export type ThemePalette = Record<ThemeColorRole, string>

export interface ColorTheme {
  id: string
  name: string
  light: ThemeColors
  dark: ThemeColors
  css: string
  builtIn: boolean
}

/** Pulpo's own colors (index.css), as hex. The Pulpo theme applies nothing so index.css stays the source. */
const PULPO_LIGHT: ThemePalette = {
  background: '#ffffff',
  surface: '#ffffff',
  raisedSurface: '#f4f4f5',
  hover: '#f4f4f5',
  text: '#09090b',
  mutedText: '#686872',
  border: '#e4e4e7',
  input: '#e4e4e7',
  action: '#18181b',
  focus: '#71717b',
  messageSurface: '#f6f6f6',
  codeSurface: '#fafafa',
  sidebar: '#fafafa',
  sidebarSelection: '#f4f4f5',
  sidebarBorder: '#e4e4e7',
  error: '#cd000f',
}

const PULPO_DARK: ThemePalette = {
  background: '#0d0d0f',
  surface: '#131316',
  raisedSurface: '#212124',
  hover: '#262629',
  text: '#fafafa',
  mutedText: '#9f9fa9',
  border: '#232325',
  input: '#2c2c2f',
  action: '#e4e4e7',
  focus: '#71717b',
  messageSurface: '#1e1e21',
  codeSurface: '#18181b',
  sidebar: '#111114',
  sidebarSelection: '#212124',
  sidebarBorder: '#242427',
  error: '#f84b4e',
}

/** Built-in themes. Names are product names, so they stay untranslated. */
export const BUILT_IN_THEMES: readonly ColorTheme[] = [
  { id: DEFAULT_COLOR_THEME_ID, name: 'Pulpo', light: PULPO_LIGHT, dark: PULPO_DARK, css: '', builtIn: true },
  {
    id: 'iris',
    name: 'Iris',
    builtIn: true,
    css: '',
    light: {
      background: '#fbf9ff',
      surface: '#ffffff',
      raisedSurface: '#f1edf9',
      hover: '#ebe5f7',
      text: '#1d1929',
      mutedText: '#6b6480',
      border: '#e2dbf0',
      input: '#d6cdea',
      action: '#b5368f',
      focus: '#7c5ce0',
      messageSurface: '#ece4fb',
      codeSurface: '#f5f2fb',
      sidebar: '#f4f0fc',
      sidebarSelection: '#e6ddf8',
      sidebarBorder: '#e2dbf0',
      error: '#d92d3a',
    },
    dark: {
      background: '#1d1929',
      surface: '#1d1929',
      raisedSurface: '#383443',
      hover: '#454250',
      text: '#fffaff',
      mutedText: '#9690a1',
      border: '#4d4366',
      input: '#5d527b',
      action: '#f099d8',
      focus: '#9d7df2',
      messageSurface: '#4b3d72',
      codeSurface: '#2a2736',
      sidebar: '#272139',
      sidebarSelection: '#433766',
      sidebarBorder: '#362d51',
      error: '#fb414a',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    builtIn: true,
    css: '',
    light: { background: '#f7fbfe', text: '#0f1d2b', action: '#0b6fbd', messageSurface: '#dcebf8', sidebar: '#eef5fb' },
    dark: { background: '#0f1720', text: '#e6f1fa', action: '#4fb0ee', messageSurface: '#1b3249', sidebar: '#0c131b' },
  },
  {
    id: 'forest',
    name: 'Forest',
    builtIn: true,
    css: '',
    light: { background: '#f8fbf8', text: '#14231a', action: '#1d7f4a', messageSurface: '#dcefe2', sidebar: '#eef5ef' },
    dark: { background: '#121a16', text: '#e7f2ea', action: '#5cc48a', messageSurface: '#1f3a2b', sidebar: '#0f1612' },
  },
  {
    id: 'ember',
    name: 'Ember',
    builtIn: true,
    css: '',
    light: { background: '#fffaf6', text: '#2a1a12', action: '#bd4f18', messageSurface: '#f9e2d3', sidebar: '#fbf1ea' },
    dark: { background: '#1c1512', text: '#fbefe8', action: '#f08a4b', messageSurface: '#3d2619', sidebar: '#18110e' },
  },
]

export function customToColorTheme(theme: CustomTheme): ColorTheme {
  return { ...theme, builtIn: false }
}

/** Every theme the user can pick, built-ins first. */
export function allColorThemes(customThemes: readonly CustomTheme[]): ColorTheme[] {
  return [...BUILT_IN_THEMES, ...customThemes.map(customToColorTheme)]
}

/** The selected theme, falling back to Pulpo when the id is unknown (a deleted or unsynced theme). */
export function findColorTheme(id: string, customThemes: readonly CustomTheme[]): ColorTheme {
  return allColorThemes(customThemes).find((theme) => theme.id === id) ?? BUILT_IN_THEMES[0]!
}

/** How each unset role follows the base colors, so a theme can start from three colors. */
function derivedColor(role: ThemeColorRole, colors: Pick<ThemePalette, 'background' | 'text' | 'action'>, dark: boolean): string {
  const { background, text, action } = colors
  switch (role) {
    case 'surface': return dark ? mixHex(background, text, 0.035) : background
    case 'raisedSurface': return mixHex(background, text, dark ? 0.09 : 0.045)
    case 'hover': return mixHex(background, text, dark ? 0.11 : 0.06)
    case 'mutedText': return mixHex(text, background, dark ? 0.35 : 0.42)
    case 'border': return mixHex(background, text, dark ? 0.1 : 0.1)
    case 'input': return mixHex(background, text, dark ? 0.14 : 0.12)
    case 'focus': return action
    case 'messageSurface': return mixHex(background, action, dark ? 0.16 : 0.1)
    case 'codeSurface': return mixHex(background, text, dark ? 0.05 : 0.025)
    case 'sidebar': return mixHex(background, text, dark ? -0.015 : 0.02)
    case 'sidebarSelection': return mixHex(background, text, dark ? 0.09 : 0.06)
    case 'sidebarBorder': return mixHex(background, text, dark ? 0.08 : 0.09)
    case 'error': return dark ? '#f8514f' : '#cd1f2b'
    default: return colors[role as 'background' | 'text' | 'action']
  }
}

/** Every role's color for one appearance: the theme's own colors, else derived from its base colors. */
export function resolvePalette(colors: ThemeColors, appearance: ThemeAppearance): ThemePalette {
  const fallback = appearance === 'dark' ? PULPO_DARK : PULPO_LIGHT
  const base = {
    background: colors.background ?? fallback.background,
    text: colors.text ?? fallback.text,
    action: colors.action ?? fallback.action,
  }
  // Follow the colors themselves, so a dark palette saved under Light still derives sensibly.
  const dark = lightness(base.background) < lightness(base.text)
  return Object.fromEntries(THEME_COLOR_ROLES.map((role) => [role, colors[role] ?? derivedColor(role, base, dark)])) as ThemePalette
}

/** CSS custom properties for a palette, in terms of the app's shadcn-style variables. */
export function paletteVariables(palette: ThemePalette): Record<string, string> {
  const onAction = mostReadable(palette.action, ['#ffffff', palette.background, palette.text, '#000000'])
  const onError = mostReadable(palette.error, ['#ffffff', '#000000'])
  return {
    '--background': palette.background,
    '--foreground': palette.text,
    '--card': palette.surface,
    '--card-foreground': palette.text,
    '--popover': palette.surface,
    '--popover-foreground': palette.text,
    '--primary': palette.action,
    '--primary-foreground': onAction,
    '--secondary': palette.raisedSurface,
    '--secondary-foreground': palette.text,
    '--muted': palette.raisedSurface,
    '--muted-foreground': palette.mutedText,
    '--accent': palette.hover,
    '--accent-foreground': palette.text,
    '--destructive': palette.error,
    '--destructive-foreground': onError,
    '--border': palette.border,
    '--input': palette.input,
    '--ring': palette.focus,
    '--sidebar': palette.sidebar,
    '--sidebar-foreground': palette.text,
    '--sidebar-accent': palette.sidebarSelection,
    '--sidebar-accent-foreground': palette.text,
    '--sidebar-border': palette.sidebarBorder,
    '--code': palette.codeSurface,
    '--code-foreground': palette.text,
    '--code-muted': palette.mutedText,
    '--code-border': palette.border,
    '--message': palette.messageSurface,
  }
}

function declarations(variables: Record<string, string>): string {
  return Object.entries(variables).map(([name, value]) => `${name}:${value};`).join('')
}

/**
 * The stylesheet for a theme: its colors for each appearance, then its custom CSS. Pulpo's
 * built-in theme yields nothing so index.css applies untouched. Unsafe CSS is left out.
 */
export function colorThemeStylesheet(theme: ColorTheme): string {
  if (theme.id === DEFAULT_COLOR_THEME_ID && theme.builtIn) return ''
  const light = declarations(paletteVariables(resolvePalette(theme.light, 'light')))
  const dark = declarations(paletteVariables(resolvePalette(theme.dark, 'dark')))
  // :root plus a class outranks index.css's `:root` and `.dark` blocks regardless of load order.
  const colors = `:root:not(.dark){${light}}:root.dark{${dark}}`
  const css = theme.css.trim() && !unsafeThemeCssReason(theme.css) ? `\n${theme.css}` : ''
  return colors + css
}

const STYLE_ELEMENT_ID = 'pulpo-color-theme'

/** Installs (or removes) the theme's stylesheet at the end of <head>. */
export function applyColorThemeStylesheet(stylesheet: string) {
  const existing = document.getElementById(STYLE_ELEMENT_ID)
  if (!stylesheet) {
    existing?.remove()
    return
  }
  if (existing?.textContent === stylesheet) return
  const element = existing ?? document.createElement('style')
  element.id = STYLE_ELEMENT_ID
  element.textContent = stylesheet
  if (!existing) document.head.appendChild(element)
}

/** A theme as a shareable file. */
export function themeToFile(theme: ColorTheme): ThemeFile {
  const own = (colors: ThemeColors) => Object.fromEntries(THEME_COLOR_ROLES.flatMap((role) => colors[role] ? [[role, colors[role]]] : []))
  return { kind: THEME_FILE_KIND, version: 1, name: theme.name, light: own(theme.light), dark: own(theme.dark), css: theme.css }
}

export function themeFileName(theme: ColorTheme): string {
  const slug = theme.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme'
  return `${slug}.pulpo-theme.json`
}

export type ThemeImportResult = { ok: true; theme: Omit<CustomTheme, 'id'> } | { ok: false; reason: 'json' | 'format' | 'css'; detail?: string }

/** Reads a theme file's text. Theme CSS that could reach the network is refused, not silently dropped. */
export function parseThemeFile(text: string): ThemeImportResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'json' }
  }
  const css = (data as { css?: unknown } | null)?.css
  if (typeof css === 'string') {
    const unsafe = unsafeThemeCssReason(css)
    if (unsafe) return { ok: false, reason: 'css', detail: unsafe }
  }
  const parsed = themeFileSchema.safeParse(data)
  if (!parsed.success) return { ok: false, reason: 'format' }
  const { name, light, dark, css: themeCss } = parsed.data
  return { ok: true, theme: { name, light, dark, css: themeCss } }
}

export function newCustomThemeId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14)
  return `custom-${random}`
}
