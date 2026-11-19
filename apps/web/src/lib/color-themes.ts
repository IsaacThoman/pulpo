import {
  DEFAULT_COLOR_THEME_ID,
  INSTANCE_COLOR_THEME_PREFIX,
  pulpoThemeExtensionSchema,
  unsafeThemeCssReason,
  type CustomTheme,
  type PulpoThemeExtension,
  type ThemeAppearance,
  type ThemeColorKey,
  type ThemeTokenRule,
  type ThemeVariant,
} from '@pulpo/contracts'
import { alphaOf, contrastRatio, flattenHex, lightness, mixHex, mostReadable, normalizeHex, solidHex, withAlpha } from './color'

/** The colors a theme can set, in editor order. Each is stored under one VS Code color id. */
export const THEME_ROLES = [
  'background', 'surface', 'raisedSurface', 'hover', 'text', 'mutedText', 'border', 'input',
  'action', 'actionText', 'focus', 'messageSurface', 'codeSurface',
  'sidebar', 'sidebarSelection', 'sidebarBorder',
  'temporaryBackground', 'temporarySurface', 'temporaryBorder', 'temporaryText', 'temporaryToggle', 'expiringText', 'planText',
  'error',
  'diffInserted', 'diffRemoved',
] as const
export type ThemeRole = (typeof THEME_ROLES)[number]

/** Code highlighting colors, which VS Code themes set through TextMate `tokenColors`. */
export const SYNTAX_ROLES = ['keyword', 'title', 'constant', 'string', 'builtin', 'comment', 'tag', 'section', 'bullet', 'addition', 'deletion'] as const
export type SyntaxRole = (typeof SYNTAX_ROLES)[number]

export type ThemeRoleGroup = 'foundation' | 'content' | 'sidebar' | 'chatModes' | 'status' | 'code'

interface RoleSpec {
  /** Where Pulpo stores the color, and what it exports. */
  key: ThemeColorKey
  /** VS Code color ids to read on import, best first. */
  imports: readonly string[]
  group: ThemeRoleGroup
  /** Painted as a solid fill, so imported translucent colors are flattened onto the background. */
  opaque?: boolean
}

export const ROLE_SPECS: Record<ThemeRole, RoleSpec> = {
  background: { key: 'editor.background', imports: ['editor.background'], group: 'foundation', opaque: true },
  surface: { key: 'editorWidget.background', imports: ['editorWidget.background', 'menu.background', 'quickInput.background', 'dropdown.background', 'editorSuggestWidget.background'], group: 'foundation', opaque: true },
  raisedSurface: { key: 'button.secondaryBackground', imports: ['button.secondaryBackground', 'input.background'], group: 'foundation', opaque: true },
  hover: { key: 'list.hoverBackground', imports: ['list.hoverBackground', 'toolbar.hoverBackground'], group: 'foundation' },
  text: { key: 'foreground', imports: ['editor.foreground', 'foreground'], group: 'foundation', opaque: true },
  mutedText: { key: 'descriptionForeground', imports: ['descriptionForeground', 'tab.inactiveForeground'], group: 'foundation' },
  border: { key: 'panel.border', imports: ['panel.border', 'editorGroup.border', 'widget.border', 'editorWidget.border', 'contrastBorder'], group: 'foundation' },
  input: { key: 'input.border', imports: ['input.border', 'dropdown.border', 'checkbox.border'], group: 'foundation' },
  action: { key: 'button.background', imports: ['button.background'], group: 'content', opaque: true },
  actionText: { key: 'button.foreground', imports: ['button.foreground'], group: 'content', opaque: true },
  focus: { key: 'focusBorder', imports: ['focusBorder'], group: 'content' },
  messageSurface: { key: 'chat.requestBackground', imports: ['chat.requestBackground'], group: 'content' },
  codeSurface: { key: 'textCodeBlock.background', imports: ['textCodeBlock.background'], group: 'content', opaque: true },
  sidebar: { key: 'sideBar.background', imports: ['sideBar.background', 'activityBar.background'], group: 'sidebar', opaque: true },
  sidebarSelection: { key: 'list.activeSelectionBackground', imports: ['list.activeSelectionBackground', 'list.inactiveSelectionBackground'], group: 'sidebar' },
  sidebarBorder: { key: 'sideBar.border', imports: ['sideBar.border'], group: 'sidebar' },
  temporaryBackground: { key: 'pulpo.temporaryChatBackground', imports: [], group: 'chatModes', opaque: true },
  temporarySurface: { key: 'pulpo.temporaryChatSurface', imports: [], group: 'chatModes' },
  temporaryBorder: { key: 'pulpo.temporaryChatBorder', imports: [], group: 'chatModes' },
  temporaryText: { key: 'pulpo.temporaryChatForeground', imports: [], group: 'chatModes' },
  temporaryToggle: { key: 'pulpo.temporaryChatToggleForeground', imports: [], group: 'chatModes' },
  expiringText: { key: 'pulpo.expiringChatForeground', imports: [], group: 'chatModes' },
  planText: { key: 'pulpo.planForeground', imports: [], group: 'chatModes' },
  error: { key: 'errorForeground', imports: ['errorForeground', 'editorError.foreground'], group: 'status' },
  diffInserted: { key: 'diffEditor.insertedTextBackground', imports: ['diffEditor.insertedTextBackground', 'diffEditor.insertedLineBackground'], group: 'code' },
  diffRemoved: { key: 'diffEditor.removedTextBackground', imports: ['diffEditor.removedTextBackground', 'diffEditor.removedLineBackground'], group: 'code' },
}

/** The roles shown outside the editor's Advanced mode; every other color derives from these. */
export const BASE_ROLES: readonly ThemeRole[] = ['background', 'text', 'action']

/** The TextMate scopes Pulpo writes for each highlighting color, and reads them back from, best first. */
export const SYNTAX_SCOPES: Record<SyntaxRole, readonly string[]> = {
  keyword: ['keyword', 'storage.type', 'storage.modifier'],
  title: ['entity.name.function', 'entity.name.type', 'entity.name.class'],
  constant: ['constant.numeric', 'constant.language', 'constant', 'variable.other.constant', 'support.constant'],
  string: ['string'],
  builtin: ['support.function', 'support.type', 'support.class', 'variable.language'],
  comment: ['comment'],
  tag: ['entity.name.tag'],
  section: ['markup.heading', 'entity.name.section'],
  bullet: ['markup.list', 'punctuation.definition.list'],
  addition: ['markup.inserted'],
  deletion: ['markup.deleted'],
}

/**
 * Concrete token scopes to look each color up by, most typical first. Real tokens are specific
 * (`keyword.control`, not `keyword`), so a theme's `keyword.operator` rule can't win for keywords.
 */
const SYNTAX_LOOKUP: Record<SyntaxRole, readonly string[]> = {
  keyword: ['keyword.control', 'storage.type', 'storage.modifier', 'keyword'],
  title: ['entity.name.function', 'entity.name.type', 'entity.name.class'],
  constant: ['constant.numeric', 'constant.language', 'variable.other.constant', 'support.constant', 'constant'],
  string: ['string.quoted', 'string'],
  builtin: ['support.function', 'support.type', 'support.class', 'variable.language'],
  comment: ['comment.line', 'comment.block', 'comment'],
  tag: ['entity.name.tag'],
  section: ['markup.heading', 'entity.name.section'],
  bullet: ['punctuation.definition.list.begin', 'markup.list'],
  addition: ['markup.inserted'],
  deletion: ['markup.deleted'],
}

export type ThemePalette = Record<ThemeRole, string>
export type SyntaxPalette = Record<SyntaxRole, string>

export interface ColorTheme {
  id: string
  name: string
  light: ThemeVariant
  dark: ThemeVariant
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
  actionText: '#fafafa',
  focus: '#71717b',
  messageSurface: '#f6f6f6',
  codeSurface: '#fafafa',
  sidebar: '#fafafa',
  sidebarSelection: '#f4f4f5',
  sidebarBorder: '#e4e4e7',
  temporaryBackground: '#f6f4ff',
  temporarySurface: '#ede9fecc',
  temporaryBorder: '#8e51ff80',
  temporaryText: '#7008e7',
  temporaryToggle: '#18181b',
  expiringText: '#00786f',
  planText: '#7f22fe',
  error: '#cd000f',
  diffInserted: '#dafbe1',
  diffRemoved: '#ffebe9',
}

const PULPO_DARK: ThemePalette = {
  background: '#0d0d0f',
  surface: '#131316',
  raisedSurface: '#212124',
  hover: '#262629',
  text: '#fafafa',
  mutedText: '#9f9fa9',
  border: '#ffffff17',
  input: '#ffffff21',
  action: '#e4e4e7',
  actionText: '#18181b',
  focus: '#71717b',
  messageSurface: '#1e1e21',
  codeSurface: '#18181b',
  sidebar: '#111114',
  sidebarSelection: '#212124',
  sidebarBorder: '#ffffff14',
  temporaryBackground: '#110f1b',
  temporarySurface: '#2f0d6899',
  temporaryBorder: '#7f22fe80',
  temporaryText: '#c4b4ff',
  temporaryToggle: '#e4e4e7',
  expiringText: '#00d5be',
  planText: '#a684ff',
  error: '#f84b4e',
  diffInserted: '#033a16',
  diffRemoved: '#67060c',
}

/** Pulpo's code highlighting (index.css), which themes fall back to. */
const PULPO_SYNTAX: Record<ThemeAppearance, SyntaxPalette> = {
  light: {
    keyword: '#cf222e', title: '#8250df', constant: '#0550ae', string: '#0a3069', builtin: '#953800', comment: '#656d76',
    tag: '#116329', section: '#0550ae', bullet: '#953800', addition: '#116329', deletion: '#82071e',
  },
  dark: {
    keyword: '#ff7b72', title: '#d2a8ff', constant: '#79c0ff', string: '#a5d6ff', builtin: '#ffa657', comment: '#8b949e',
    tag: '#7ee787', section: '#1f6feb', bullet: '#f2cc60', addition: '#aff5b4', deletion: '#ffdcd7',
  },
}

const PULPO_PALETTE: Record<ThemeAppearance, ThemePalette> = { light: PULPO_LIGHT, dark: PULPO_DARK }

/** A rule Pulpo writes for one highlighting color; its name marks it as Pulpo's. */
export function syntaxRule(role: SyntaxRole, foreground: string): ThemeTokenRule {
  return { name: `pulpo.${role}`, scope: [...SYNTAX_SCOPES[role]], settings: { foreground } }
}

/** A theme variant from role colors, stored under their VS Code ids. */
export function variantFromRoles(roles: Partial<ThemePalette>, syntax: Partial<SyntaxPalette> = {}): ThemeVariant {
  return {
    colors: Object.fromEntries(Object.entries(roles).map(([role, color]) => [ROLE_SPECS[role as ThemeRole].key, color])),
    tokenColors: SYNTAX_ROLES.flatMap((role) => syntax[role] ? [syntaxRule(role, syntax[role])] : []),
  }
}

/** Built-in themes. Names are product names, so they stay untranslated. */
export const BUILT_IN_THEMES: readonly ColorTheme[] = [
  {
    id: DEFAULT_COLOR_THEME_ID,
    name: 'Pulpo',
    builtIn: true,
    css: '',
    light: variantFromRoles(PULPO_LIGHT, PULPO_SYNTAX.light),
    dark: variantFromRoles(PULPO_DARK, PULPO_SYNTAX.dark),
  },
  {
    id: 'iris',
    name: 'Iris',
    builtIn: true,
    css: '',
    light: variantFromRoles({
      background: '#fbf9ff', surface: '#ffffff', raisedSurface: '#f1edf9', hover: '#ebe5f7', text: '#1d1929', mutedText: '#6b6480',
      border: '#e2dbf0', input: '#d6cdea', action: '#b5368f', focus: '#7c5ce0', messageSurface: '#ece4fb', codeSurface: '#f5f2fb',
      sidebar: '#f4f0fc', sidebarSelection: '#e6ddf8', sidebarBorder: '#e2dbf0', error: '#d92d3a',
    }),
    dark: variantFromRoles({
      background: '#1d1929', surface: '#1d1929', raisedSurface: '#383443', hover: '#454250', text: '#fffaff', mutedText: '#9690a1',
      border: '#4d4366', input: '#5d527b', action: '#f099d8', focus: '#9d7df2', messageSurface: '#4b3d72', codeSurface: '#2a2736',
      sidebar: '#272139', sidebarSelection: '#433766', sidebarBorder: '#362d51', error: '#fb414a',
    }),
  },
  {
    id: 'ocean',
    name: 'Ocean',
    builtIn: true,
    css: '',
    light: variantFromRoles({ background: '#f7fbfe', text: '#0f1d2b', action: '#0b6fbd', messageSurface: '#dcebf8', sidebar: '#eef5fb' }),
    dark: variantFromRoles({ background: '#0f1720', text: '#e6f1fa', action: '#4fb0ee', messageSurface: '#1b3249', sidebar: '#0c131b' }),
  },
  {
    id: 'forest',
    name: 'Forest',
    builtIn: true,
    css: '',
    light: variantFromRoles({ background: '#f8fbf8', text: '#14231a', action: '#1d7f4a', messageSurface: '#dcefe2', sidebar: '#eef5ef' }),
    dark: variantFromRoles({ background: '#121a16', text: '#e7f2ea', action: '#5cc48a', messageSurface: '#1f3a2b', sidebar: '#0f1612' }),
  },
  {
    id: 'ember',
    name: 'Ember',
    builtIn: true,
    css: '',
    light: variantFromRoles({ background: '#fffaf6', text: '#2a1a12', action: '#bd4f18', messageSurface: '#f9e2d3', sidebar: '#fbf1ea' }),
    dark: variantFromRoles({ background: '#1c1512', text: '#fbefe8', action: '#f08a4b', messageSurface: '#3d2619', sidebar: '#18110e' }),
  },
]

export function customToColorTheme(theme: CustomTheme): ColorTheme {
  return { ...theme, builtIn: false }
}

/** Every theme the user can pick, built-ins first. */
export function allColorThemes(customThemes: readonly CustomTheme[], instanceThemes: readonly CustomTheme[] = []): ColorTheme[] {
  return [
    ...BUILT_IN_THEMES,
    ...instanceThemes.map((theme) => customToColorTheme({ ...theme, id: INSTANCE_COLOR_THEME_PREFIX + theme.id })),
    ...customThemes.map(customToColorTheme),
  ]
}

/** The selected theme, falling back to Pulpo when the id is unknown (a deleted or unsynced theme). */
export function findColorTheme(id: string, customThemes: readonly CustomTheme[], instanceThemes?: readonly CustomTheme[]): ColorTheme {
  return allColorThemes(customThemes, instanceThemes).find((theme) => theme.id === id) ?? BUILT_IN_THEMES[0]!
}

/** How an unset color follows the colors before it, so a theme can start from three colors. */
function derivedColor(role: ThemeRole, palette: Partial<ThemePalette>, dark: boolean): string {
  const background = palette.background!
  const text = palette.text!
  const action = palette.action!
  // Temporary chats are violet in every theme, as in Pulpo's: the same tints over this theme's background.
  const violet = PULPO_PALETTE[dark ? 'dark' : 'light']
  switch (role) {
    case 'surface': return dark ? mixHex(background, text, 0.035) : background
    case 'raisedSurface': return mixHex(background, text, dark ? 0.09 : 0.045)
    case 'hover': return mixHex(background, text, dark ? 0.11 : 0.06)
    case 'mutedText': return mixHex(text, background, dark ? 0.35 : 0.42)
    case 'border': return mixHex(background, text, 0.1)
    case 'input': return mixHex(background, text, dark ? 0.14 : 0.12)
    case 'actionText': return mostReadable(action, ['#ffffff', background, text, '#000000'])
    case 'focus': return action
    case 'messageSurface': return mixHex(background, action, dark ? 0.16 : 0.1)
    case 'codeSurface': return mixHex(background, text, dark ? 0.05 : 0.025)
    case 'sidebar': return mixHex(background, text, dark ? -0.015 : 0.02)
    case 'sidebarSelection': return mixHex(background, text, dark ? 0.09 : 0.06)
    case 'sidebarBorder': return mixHex(background, text, dark ? 0.08 : 0.09)
    case 'temporaryBackground': return dark ? mixHex(background, '#2f0d68', 0.15) : mixHex(background, '#ede9fe', 0.5)
    case 'temporarySurface': return violet.temporarySurface
    case 'temporaryBorder': return violet.temporaryBorder
    case 'temporaryText': return contrastRatio(violet.temporaryText, background) >= 4.5 ? violet.temporaryText : text
    case 'temporaryToggle': return action
    case 'expiringText': return dark ? '#00d5be' : '#00786f'
    case 'planText': return violet.planText
    case 'error': return dark ? '#f8514f' : '#cd1f2b'
    case 'diffInserted': return PULPO_PALETTE[dark ? 'dark' : 'light'].diffInserted
    case 'diffRemoved': return PULPO_PALETTE[dark ? 'dark' : 'light'].diffRemoved
    default: return palette[role]!
  }
}

/** Every role's color for one appearance: the theme's own colors, else derived from its base colors. */
export function resolvePalette(variant: ThemeVariant, appearance: ThemeAppearance): ThemePalette {
  const fallback = PULPO_PALETTE[appearance]
  const own = (role: ThemeRole) => variant.colors[ROLE_SPECS[role].key]
  const palette: Partial<ThemePalette> = {}
  palette.background = flattenHex(own('background') ?? fallback.background, fallback.background)
  palette.text = flattenHex(own('text') ?? fallback.text, palette.background)
  palette.action = flattenHex(own('action') ?? fallback.action, palette.background)
  // Follow the colors themselves, so a dark palette saved under Light still derives sensibly.
  const dark = lightness(palette.background) < lightness(palette.text)
  for (const role of THEME_ROLES) {
    if (palette[role]) continue
    const color = own(role) ?? derivedColor(role, palette, dark)
    palette[role] = ROLE_SPECS[role].opaque ? flattenHex(color, palette.background) : color
  }
  return palette as ThemePalette
}

function selectors(rule: { scope?: unknown }): string[] {
  const scopes = typeof rule.scope === 'string' ? [rule.scope] : Array.isArray(rule.scope) ? rule.scope : []
  return scopes.flatMap((scope) => typeof scope === 'string' ? scope.split(',') : []).map((scope) => scope.trim())
    .filter((scope) => scope && /^[\w.-]+$/.test(scope))
}

/**
 * The foreground VS Code would most likely give `role`'s scopes. TextMate prefers the deepest
 * selector that is a prefix of the scope; a deeper selector (like `keyword.control` for `keyword`)
 * is a weaker fallback. Later rules win ties, as in VS Code.
 */
function tokenForeground(rules: readonly unknown[], role: SyntaxRole): string | undefined {
  for (const target of SYNTAX_LOOKUP[role]) {
    let best: { score: number; color: string } | undefined
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object') continue
      const foreground = normalizeHex(String((rule as { settings?: { foreground?: unknown } }).settings?.foreground ?? ''))
      if (!foreground) continue
      for (const selector of selectors(rule as { scope?: unknown })) {
        const depth = selector.split('.').length
        const score = target === selector || target.startsWith(`${selector}.`)
          ? 100 + depth
          : selector.startsWith(`${target}.`) ? 50 - depth : -1
        if (score >= 0 && (!best || score >= best.score)) best = { score, color: foreground }
      }
    }
    if (best) return best.color
  }
  return undefined
}

/** Code highlighting colors for one appearance: from the theme's token rules, else Pulpo's. */
export function resolveSyntax(variant: ThemeVariant, appearance: ThemeAppearance): SyntaxPalette {
  return Object.fromEntries(SYNTAX_ROLES.map((role) => [role, tokenForeground(variant.tokenColors, role) ?? PULPO_SYNTAX[appearance][role]])) as SyntaxPalette
}

/** Whether the theme sets this highlighting color itself. */
export function hasOwnSyntax(variant: ThemeVariant, role: SyntaxRole): boolean {
  return tokenForeground(variant.tokenColors, role) !== undefined
}

/** Sets (or, with null, clears) one highlighting color, keeping Pulpo's rules one per color. */
export function withSyntaxColor(variant: ThemeVariant, role: SyntaxRole, color: string | null): ThemeVariant {
  const rest = variant.tokenColors.filter((rule) => rule.name !== `pulpo.${role}`)
  return { ...variant, tokenColors: color ? [...rest, syntaxRule(role, color)] : rest }
}

/** CSS custom properties for a palette, in terms of the app's shadcn-style variables. */
export function paletteVariables(palette: ThemePalette, syntax: SyntaxPalette): Record<string, string> {
  const onError = mostReadable(solidHex(palette.error), ['#ffffff', '#000000'])
  const temporaryCard = flattenHex(palette.temporarySurface, palette.temporaryBackground)
  return {
    '--background': palette.background,
    '--foreground': palette.text,
    '--card': palette.surface,
    '--card-foreground': palette.text,
    '--popover': palette.surface,
    '--popover-foreground': palette.text,
    '--primary': palette.action,
    '--primary-foreground': palette.actionText,
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
    '--temporary-chat-background': palette.temporaryBackground,
    '--temporary-surface': palette.temporarySurface,
    '--temporary-card': palette.temporarySurface,
    '--temporary-card-hover': withAlpha(mixHex(temporaryCard, palette.text, 0.06), Math.max(alphaOf(palette.temporarySurface), 0.8)),
    '--temporary-border': palette.temporaryBorder,
    '--temporary-card-border': palette.temporaryBorder,
    '--temporary-foreground': palette.temporaryText,
    '--temporary-toggle': palette.temporaryToggle,
    '--expiring-foreground': palette.expiringText,
    '--plan-foreground': palette.planText,
    '--code-keyword': syntax.keyword,
    '--code-title': syntax.title,
    '--code-constant': syntax.constant,
    '--code-string': syntax.string,
    '--code-builtin': syntax.builtin,
    '--code-comment': syntax.comment,
    '--code-tag': syntax.tag,
    '--code-section': syntax.section,
    '--code-bullet': syntax.bullet,
    '--code-addition': syntax.addition,
    '--code-addition-background': palette.diffInserted,
    '--code-deletion': syntax.deletion,
    '--code-deletion-background': palette.diffRemoved,
  }
}

function declarations(variant: ThemeVariant, appearance: ThemeAppearance): string {
  const variables = paletteVariables(resolvePalette(variant, appearance), resolveSyntax(variant, appearance))
  return Object.entries(variables).map(([name, value]) => `${name}:${value};`).join('')
}

/**
 * The stylesheet for a theme: its colors for each appearance, then its custom CSS. Pulpo's
 * built-in theme yields nothing so index.css applies untouched. Unsafe CSS is left out.
 */
export function colorThemeStylesheet(theme: ColorTheme): string {
  if (theme.id === DEFAULT_COLOR_THEME_ID && theme.builtIn) return ''
  // :root plus a class outranks index.css's `:root` and `.dark` blocks regardless of load order.
  const colors = `:root:not(.dark){${declarations(theme.light, 'light')}}:root.dark{${declarations(theme.dark, 'dark')}}`
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

/**
 * One appearance as a VS Code color theme, with every color resolved so it looks complete in VS Code.
 * The `pulpo` property carries both appearances and the custom CSS so Pulpo can import it back whole.
 */
export function themeToVsCode(theme: ColorTheme, appearance: ThemeAppearance) {
  const palette = resolvePalette(theme[appearance], appearance)
  const syntax = resolveSyntax(theme[appearance], appearance)
  const pulpo: PulpoThemeExtension = { version: 1, light: theme.light, dark: theme.dark, css: theme.css }
  return {
    $schema: 'vscode://schemas/color-theme',
    name: theme.name,
    type: appearance,
    colors: Object.fromEntries(THEME_ROLES.map((role) => [ROLE_SPECS[role].key, palette[role]])),
    tokenColors: SYNTAX_ROLES.map((role) => syntaxRule(role, syntax[role])),
    pulpo,
  }
}

export function vsCodeThemeFileName(theme: ColorTheme, appearance: ThemeAppearance): string {
  const slug = theme.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme'
  return `${slug}-${appearance}-color-theme.json`
}

/** Walks JSON text, copying strings whole and handing everything outside them to `outside`. */
function mapOutsideJsonStrings(text: string, outside: (text: string, index: number) => { emit: string; next: number }): string {
  let output = ''
  let index = 0
  while (index < text.length) {
    if (text[index] === '"') {
      const start = index
      index += 1
      while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1
      output += text.slice(start, index + 1)
      index += 1
    } else {
      const step = outside(text, index)
      output += step.emit
      index = step.next
    }
  }
  return output
}

/**
 * JSON with comments and trailing commas, as VS Code theme files are written, made plain JSON.
 * Comments go first, so one between a trailing comma and its bracket doesn't keep the comma.
 */
export function stripJsonc(text: string): string {
  const withoutComments = mapOutsideJsonStrings(text, (source, index) => {
    if (source[index] === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index)
      return { emit: '', next: end === -1 ? source.length : end }
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      return { emit: ' ', next: end === -1 ? source.length : end + 2 }
    }
    return { emit: source[index]!, next: index + 1 }
  })
  return mapOutsideJsonStrings(withoutComments, (source, index) => {
    if (source[index] !== ',') return { emit: source[index]!, next: index + 1 }
    let next = index + 1
    while (next < source.length && /\s/.test(source[next]!)) next += 1
    return { emit: source[next] === '}' || source[next] === ']' ? '' : ',', next: index + 1 }
  })
}

/** A VS Code theme's colors, as one Pulpo appearance. */
function variantFromVsCode(colors: Record<string, unknown>, tokenColors: unknown): ThemeVariant {
  const color = (key: string) => typeof colors[key] === 'string' ? normalizeHex(colors[key]) : null
  const background = color('editor.background')
  const own: Partial<ThemePalette> = {}
  for (const role of THEME_ROLES) {
    const spec = ROLE_SPECS[role]
    const value = [spec.key, ...spec.imports].map(color).find(Boolean)
    if (value) own[role] = spec.opaque && background && role !== 'background' ? flattenHex(value, background) : value
  }
  const rules = Array.isArray(tokenColors) ? tokenColors : []
  const variant = variantFromRoles(own)
  for (const role of SYNTAX_ROLES) {
    const foreground = tokenForeground(rules, role)
    if (foreground) variant.tokenColors.push(syntaxRule(role, foreground))
  }
  return variant
}

export type ThemeImport =
  | {
    ok: true
    name: string
    /** The appearance the file's own colors are for. */
    appearance: ThemeAppearance
    variant: ThemeVariant
    /** Both appearances and CSS, when the file was exported from Pulpo. */
    pulpo: PulpoThemeExtension | null
    /** The file builds on another theme file (`include`), which can't be read from here. */
    partial: boolean
  }
  | { ok: false; reason: 'json' | 'format' | 'css' | 'vsix'; detail?: string }

/** Reads a VS Code color theme file (or one Pulpo exported). Unsafe Pulpo CSS refuses the whole file. */
export function parseVsCodeTheme(text: string, fileName = ''): ThemeImport {
  if (text.startsWith('PK') || fileName.toLowerCase().endsWith('.vsix')) return { ok: false, reason: 'vsix' }
  let data: unknown
  try {
    data = JSON.parse(stripJsonc(text.replace(/^﻿/, '')))
  } catch {
    return { ok: false, reason: 'json' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'format' }
  const theme = data as { name?: unknown; type?: unknown; colors?: unknown; tokenColors?: unknown; include?: unknown; pulpo?: unknown }
  const colors = theme.colors && typeof theme.colors === 'object' ? theme.colors as Record<string, unknown> : {}
  let pulpo: PulpoThemeExtension | null = null
  if (theme.pulpo !== undefined) {
    const css = (theme.pulpo as { css?: unknown } | null)?.css
    if (typeof css === 'string' && unsafeThemeCssReason(css)) return { ok: false, reason: 'css', detail: unsafeThemeCssReason(css)! }
    const parsed = pulpoThemeExtensionSchema.safeParse(theme.pulpo)
    if (parsed.success) pulpo = parsed.data
  }
  const variant = variantFromVsCode(colors, theme.tokenColors)
  if (!Object.keys(variant.colors).length && !variant.tokenColors.length && !pulpo) return { ok: false, reason: 'format' }
  const background = typeof colors['editor.background'] === 'string' ? normalizeHex(colors['editor.background']) : null
  const appearance: ThemeAppearance = theme.type === 'light' || theme.type === 'hc-light'
    ? 'light'
    : theme.type === 'dark' || theme.type === 'hc-black' || !background || lightness(solidHex(background)) < 0.6 ? 'dark' : 'light'
  const name = typeof theme.name === 'string' && theme.name.trim()
    ? theme.name.trim()
    : fileName.replace(/(-color-theme)?\.jsonc?$/i, '').trim() || 'Imported theme'
  return { ok: true, name: name.slice(0, 60), appearance, variant, pulpo, partial: typeof theme.include === 'string' }
}

export function newCustomThemeId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14)
  return `custom-${random}`
}
