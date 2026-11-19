import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import {
  CUSTOM_THEMES_MAX,
  DEFAULT_COLOR_THEME_ID,
  INSTANCE_COLOR_THEME_PREFIX,
  THEME_CSS_MAX_LENGTH,
  THEME_NAME_MAX_LENGTH,
  unsafeThemeCssReason,
  type CustomTheme,
  type ThemeAppearance,
  type ThemeVariant,
} from '@pulpo/contracts'
import { Check, ChevronDown, ChevronRight, Copy, Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { alphaOf, normalizeHex, solidHex, withAlpha } from '@/lib/color'
import {
  allColorThemes,
  BASE_ROLES,
  customToColorTheme,
  newCustomThemeId,
  parseVsCodeTheme,
  resolvePalette,
  resolveSyntax,
  ROLE_SPECS,
  SYNTAX_ROLES,
  SYNTAX_SCOPES,
  THEME_ROLES,
  themeToVsCode,
  vsCodeThemeFileName,
  withSyntaxColor,
  type ColorTheme,
  type SyntaxRole,
  type ThemeImport,
  type ThemeRole,
  type ThemeRoleGroup,
} from '@/lib/color-themes'
import { cn } from '@/lib/utils'
import { ui, uit } from '@/i18n/ui'
import { useTranslation } from '@/i18n/useAppTranslation'
import { useSettings } from '@/stores/settings'

const GROUPS: ThemeRoleGroup[] = ['foundation', 'content', 'sidebar', 'chatModes', 'status', 'code']
const CSS_PLACEHOLDER = '.dark [data-slot="button"] {\n  border-radius: 999px;\n}'
const EMPTY_VARIANT: ThemeVariant = { colors: {}, tokenColors: [] }
const MAX_THEME_FILE_BYTES = 2 * 1024 * 1024

function groupLabel(group: ThemeRoleGroup): string {
  switch (group) {
    case 'foundation': return ui('Foundation')
    case 'content': return ui('Brand & content')
    case 'sidebar': return ui('Sidebar')
    case 'chatModes': return ui('Chat modes')
    case 'status': return ui('Status')
    case 'code': return ui('Code')
  }
}

function roleLabel(role: ThemeRole): string {
  switch (role) {
    case 'background': return ui('Background')
    case 'surface': return ui('Cards and menus')
    case 'raisedSurface': return ui('Raised surface')
    case 'hover': return ui('Hover')
    case 'text': return ui('Text')
    case 'mutedText': return ui('Muted text')
    case 'border': return ui('Border')
    case 'input': return ui('Input border')
    case 'action': return ui('Action')
    case 'actionText': return ui('Action text')
    case 'focus': return ui('Focus ring')
    case 'messageSurface': return ui('Your messages')
    case 'codeSurface': return ui('Code blocks')
    case 'sidebar': return ui('Sidebar background')
    case 'sidebarSelection': return ui('Sidebar selection')
    case 'sidebarBorder': return ui('Sidebar border')
    case 'temporaryBackground': return ui('Temporary chat background')
    case 'temporarySurface': return ui('Temporary composer and cards')
    case 'temporaryBorder': return ui('Temporary border')
    case 'temporaryText': return ui('Temporary label')
    case 'temporaryToggle': return ui('Temporary toggle')
    case 'expiringText': return ui('Expiring chat label')
    case 'planText': return ui('Plan name')
    case 'error': return ui('Error')
    case 'diffInserted': return ui('Inserted lines')
    case 'diffRemoved': return ui('Removed lines')
  }
}

function syntaxLabel(role: SyntaxRole): string {
  switch (role) {
    case 'keyword': return ui('Keywords')
    case 'title': return ui('Functions and types')
    case 'constant': return ui('Numbers and constants')
    case 'string': return ui('Strings')
    case 'builtin': return ui('Built-ins')
    case 'comment': return ui('Comments')
    case 'tag': return ui('Tags')
    case 'section': return ui('Headings')
    case 'bullet': return ui('List markers')
    case 'addition': return ui('Inserted text')
    case 'deletion': return ui('Deleted text')
  }
}

function subscribeToColorScheme(onChange: () => void) {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Which appearance the app shows now, so previews and the editor start on what the user sees. */
function useActiveAppearance(): ThemeAppearance {
  const mode = useSettings((state) => state.theme)
  const systemDark = useSyncExternalStore(subscribeToColorScheme, () => window.matchMedia('(prefers-color-scheme: dark)').matches)
  return mode === 'dark' || (mode === 'system' && systemDark) ? 'dark' : 'light'
}

async function readThemeFile(file: File): Promise<ThemeImport> {
  if (file.size > MAX_THEME_FILE_BYTES) return { ok: false, reason: 'format' }
  try {
    return parseVsCodeTheme(await file.text(), file.name)
  } catch {
    return { ok: false, reason: 'json' }
  }
}

function importError(result: Extract<ThemeImport, { ok: false }>): string {
  switch (result.reason) {
    case 'vsix': return ui('That’s a .vsix extension. Unzip it and import the theme’s .json file from its themes folder.')
    case 'css': return ui('This theme’s CSS loads content from the internet, so it wasn’t imported.')
    default: return ui('That file isn’t a VS Code color theme.')
  }
}

function ThemePreview({ theme, appearance }: { theme: ColorTheme; appearance: ThemeAppearance }) {
  const palette = resolvePalette(theme[appearance], appearance)
  return (
    <div aria-hidden className="flex h-14 overflow-hidden rounded-md border" style={{ backgroundColor: palette.background, borderColor: palette.border }}>
      <div className="flex w-1/4 flex-col gap-1 p-1.5" style={{ backgroundColor: palette.sidebar, borderRight: `1px solid ${palette.sidebarBorder}` }}>
        <div className="h-1.5 rounded-full" style={{ backgroundColor: palette.sidebarSelection }} />
        <div className="h-1 w-3/4 rounded-full" style={{ backgroundColor: palette.mutedText, opacity: 0.6 }} />
        <div className="h-1 w-2/3 rounded-full" style={{ backgroundColor: palette.mutedText, opacity: 0.6 }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-2">
        <div className="ml-auto h-2.5 w-3/5 rounded-full" style={{ backgroundColor: palette.messageSurface }} />
        <div className="h-1 w-4/5 rounded-full" style={{ backgroundColor: palette.text, opacity: 0.75 }} />
        <div className="flex items-center gap-1">
          <div className="h-1 w-1/2 rounded-full" style={{ backgroundColor: palette.mutedText }} />
          <div className="ml-auto size-2.5 rounded-full" style={{ backgroundColor: palette.action }} />
        </div>
      </div>
    </div>
  )
}

/** A hex field that keeps what the user is typing until it is a whole color. */
function HexInput({ value, label, derived, onCommit }: { value: string; label: string; derived: boolean; onCommit: (hex: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(value)
  }, [focused, value])
  const commit = (text: string) => {
    const hex = normalizeHex(text)
    if (hex && [6, 8].includes(text.replace('#', '').length)) onCommit(hex)
  }
  return (
    <Input
      aria-label={label}
      value={focused ? draft : value}
      spellCheck={false}
      autoComplete="off"
      maxLength={9}
      className={cn('h-8 w-28 font-mono text-sm', derived && !focused && 'text-muted-foreground')}
      onFocus={() => { setDraft(value); setFocused(true) }}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        setDraft(event.target.value)
        commit(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        const hex = normalizeHex(draft)
        if (hex) onCommit(hex)
        event.currentTarget.blur()
      }}
    />
  )
}

function ColorRow({ label, vsCodeId, value, derived, canReset, onChange, onReset }: {
  label: string
  /** Shown in Advanced mode so VS Code theme authors know which id to set. */
  vsCodeId?: string
  value: string
  derived: boolean
  canReset: boolean
  onChange: (hex: string) => void
  onReset: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-1.5 pl-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-muted-foreground">{label}</div>
        {vsCodeId && <div className="truncate font-mono text-[11px] text-muted-foreground/70">{vsCodeId}</div>}
      </div>
      {canReset && (
        <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label={uit`Reset ${label}`} title={ui('Reset to the derived color')} onClick={onReset}>
          <RotateCcw className="size-3.5" aria-hidden />
        </Button>
      )}
      <div className="relative size-7 shrink-0">
        <input
          type="color"
          aria-label={uit`Pick ${label}`}
          value={solidHex(value)}
          className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
          // The picker has no alpha, so a translucent color keeps its alpha.
          onChange={(event) => onChange(withAlpha(event.currentTarget.value, alphaOf(value)))}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full border border-foreground/20 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
          style={{ backgroundColor: value }}
        />
      </div>
      <HexInput value={value} label={label} derived={derived} onCommit={onChange} />
    </div>
  )
}

function SegmentedAppearance({ value, onChange, labelledBy }: { value: ThemeAppearance; onChange: (value: ThemeAppearance) => void; labelledBy: string }) {
  const { t } = useTranslation()
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex rounded-lg border p-0.5">
      {(['light', 'dark'] as const).map((appearance) => (
        <button
          key={appearance}
          type="button"
          aria-pressed={value === appearance}
          onClick={() => onChange(appearance)}
          className={cn(
            'flex-1 cursor-pointer rounded-md px-3 py-1 text-sm transition-colors',
            value === appearance ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {appearance === 'light' ? t('settings.general.light') : t('settings.general.dark')}
        </button>
      ))}
    </div>
  )
}

function ThemeEditor({ theme, activeAppearance, allowCss, onUpdate }: {
  theme: CustomTheme
  activeAppearance: ThemeAppearance
  allowCss: boolean
  onUpdate: (patch: Partial<Omit<CustomTheme, 'id'>>) => void
}) {
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [appearance, setAppearance] = useState<ThemeAppearance>(activeAppearance)
  const [advanced, setAdvanced] = useState(false)
  const [filter, setFilter] = useState('')
  const [name, setName] = useState(theme.name)
  const [css, setCss] = useState(theme.css)
  const [cssOpen, setCssOpen] = useState(Boolean(theme.css.trim()))
  const [message, setMessage] = useState<{ kind: 'error' | 'status'; text: string } | null>(null)

  // Edit what's on screen: switching the app between light and dark switches the editor too.
  useEffect(() => setAppearance(activeAppearance), [activeAppearance])
  // Another device (or an import) can change the theme under the editor.
  useEffect(() => setName(theme.name), [theme.name])
  useEffect(() => setCss(theme.css), [theme.css])

  const variant = theme[appearance]
  const palette = resolvePalette(variant, appearance)
  const syntax = resolveSyntax(variant, appearance)
  const query = filter.trim().toLowerCase()
  const matches = (label: string, ids: readonly string[]) => !query || label.toLowerCase().includes(query) || ids.some((value) => value.toLowerCase().includes(query))
  const roles = (group: ThemeRoleGroup) => THEME_ROLES.filter((role) => ROLE_SPECS[role].group === group
    && (advanced || BASE_ROLES.includes(role))
    && matches(roleLabel(role), [ROLE_SPECS[role].key]))
  const syntaxRoles = advanced ? SYNTAX_ROLES.filter((role) => matches(syntaxLabel(role), SYNTAX_SCOPES[role])) : []
  const groups = GROUPS.map((group) => ({ group, roles: roles(group), syntax: group === 'code' ? syntaxRoles : [] }))
    .filter((entry) => entry.roles.length || entry.syntax.length)
  const ownRule = (role: SyntaxRole) => variant.tokenColors.some((rule) => rule.name === `pulpo.${role}`)
  const hiddenOverrides = advanced
    ? 0
    : Object.keys(variant.colors).filter((key) => !BASE_ROLES.some((role) => ROLE_SPECS[role].key === key)).length + SYNTAX_ROLES.filter(ownRule).length
  const cssError = css.length > THEME_CSS_MAX_LENGTH
    ? uit`Theme CSS can be up to ${THEME_CSS_MAX_LENGTH.toLocaleString()} characters.`
    : (unsafeThemeCssReason(css) ? ui('Theme CSS can’t load anything from the internet: no @import, and url() only with data: or #id.') : '')

  const setVariant = (next: ThemeVariant) => onUpdate({ [appearance]: next })
  const setColor = (role: ThemeRole, hex: string | null) => {
    const colors = { ...variant.colors }
    if (hex) colors[ROLE_SPECS[role].key] = hex
    else delete colors[ROLE_SPECS[role].key]
    setVariant({ ...variant, colors })
  }

  const importInto = async (file: File) => {
    const result = await readThemeFile(file)
    if (!result.ok) {
      setMessage({ kind: 'error', text: importError(result) })
      return
    }
    setVariant(result.pulpo?.[appearance] ?? result.variant)
    setMessage({
      kind: 'status',
      text: appearance === 'light' ? uit`Light colors now come from “${result.name}”.` : uit`Dark colors now come from “${result.name}”.`,
    })
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">{ui('Theme name')}</label>
        <Input
          id={`${id}-name`}
          value={name}
          maxLength={THEME_NAME_MAX_LENGTH}
          className="w-full sm:w-56"
          onChange={(event) => {
            setName(event.target.value)
            if (event.target.value.trim()) onUpdate({ name: event.target.value.trim() })
          }}
          onBlur={() => setName(theme.name)}
        />
      </div>
      <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div id={`${id}-appearance`} className="text-sm font-medium">{ui('Appearance')}</div>
          {allowCss && appearance !== activeAppearance && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {appearance === 'light' ? ui('Switch Theme to Light to preview these colors.') : ui('Switch Theme to Dark to preview these colors.')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload className="size-3.5" aria-hidden />
            {appearance === 'light' ? ui('Import light colors') : ui('Import dark colors')}
          </Button>
          <SegmentedAppearance value={appearance} onChange={(value) => { setMessage(null); setAppearance(value) }} labelledBy={`${id}-appearance`} />
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.jsonc,application/json"
          className="hidden"
          data-testid="theme-editor-import"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void importInto(file)
          }}
        />
      </div>
      {!allowCss && <div className="py-2"><ThemePreview theme={customToColorTheme(theme)} appearance={appearance} /></div>}
      {message?.kind === 'error' && <p role="alert" className="text-xs text-destructive">{message.text}</p>}
      <p role="status" className={cn('text-xs text-muted-foreground', message?.kind !== 'status' && 'sr-only')}>
        {message?.kind === 'status' ? message.text : ''}
      </p>
      <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium">{ui('Colors')}</div>
        <div className="flex items-center gap-3">
          <Input
            type="search"
            aria-label={ui('Filter colors')}
            placeholder={ui('Filter colors')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-8 w-full sm:w-40"
          />
          <label htmlFor={`${id}-advanced`} className="text-sm">{ui('Advanced')}</label>
          <Switch id={`${id}-advanced`} checked={advanced} onCheckedChange={setAdvanced} />
        </div>
      </div>
      {groups.map(({ group, roles: groupRoles, syntax: groupSyntax }) => (
        <section key={group} aria-labelledby={`${id}-${group}`} className="pt-2">
          <h4 id={`${id}-${group}`} className={advanced ? 'py-1 text-sm font-medium' : 'sr-only'}>{groupLabel(group)}</h4>
          {groupRoles.map((role) => (
            <ColorRow
              key={`${appearance}-${role}`}
              label={roleLabel(role)}
              vsCodeId={advanced ? ROLE_SPECS[role].key : undefined}
              value={palette[role]}
              derived={!variant.colors[ROLE_SPECS[role].key]}
              canReset={advanced && Boolean(variant.colors[ROLE_SPECS[role].key]) && !BASE_ROLES.includes(role)}
              onChange={(hex) => setColor(role, hex)}
              onReset={() => setColor(role, null)}
            />
          ))}
          {groupSyntax.map((role) => (
            <ColorRow
              key={`${appearance}-syntax-${role}`}
              label={syntaxLabel(role)}
              vsCodeId={SYNTAX_SCOPES[role][0]}
              value={syntax[role]}
              derived={!ownRule(role)}
              canReset={ownRule(role)}
              onChange={(hex) => setVariant(withSyntaxColor(variant, role, hex))}
              onReset={() => setVariant(withSyntaxColor(variant, role, null))}
            />
          ))}
        </section>
      ))}
      {!groups.length && <p className="py-3 text-sm text-muted-foreground">{ui('No colors match.')}</p>}
      {!advanced && (
        <p className="pt-1 text-xs text-muted-foreground">
          {hiddenOverrides === 0
            ? ui('Other colors follow these three. Turn on Advanced to set them yourself, including temporary chats and code.')
            : hiddenOverrides === 1
              ? ui('1 more color is set in Advanced.')
              : uit`${hiddenOverrides} more colors are set in Advanced.`}
        </p>
      )}
      {allowCss && <Collapsible open={cssOpen} onOpenChange={setCssOpen} className="pt-3">
        <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1.5 text-sm font-medium">
          <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
          {ui('Custom CSS')}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <p id={`${id}-css-hint`} className="mb-2 text-xs text-muted-foreground">
            {ui('Applies after Pulpo’s styles in both appearances. Use .dark or :root:not(.dark) to target one. Add !important if a rule has no effect.')}
          </p>
          <Textarea
            aria-label={ui('Custom CSS')}
            aria-describedby={`${id}-css-hint`}
            aria-invalid={cssError ? true : undefined}
            value={css}
            spellCheck={false}
            rows={8}
            placeholder={CSS_PLACEHOLDER}
            className="font-mono text-xs"
            onChange={(event) => {
              const next = event.target.value
              setCss(next)
              if (next.length <= THEME_CSS_MAX_LENGTH && !unsafeThemeCssReason(next)) onUpdate({ css: next })
            }}
          />
          <div className="mt-1 flex flex-wrap items-start justify-between gap-2 text-xs">
            {cssError ? <p role="alert" className="text-destructive">{cssError}</p> : <span />}
            <span className={cn('text-muted-foreground', css.length > THEME_CSS_MAX_LENGTH && 'text-destructive')}>
              {css.length.toLocaleString()} / {THEME_CSS_MAX_LENGTH.toLocaleString()}
            </span>
          </div>
        </CollapsibleContent>
      </Collapsible>}
    </div>
  )
}

function downloadVsCodeTheme(theme: ColorTheme, appearance: ThemeAppearance) {
  const blob = new Blob([`${JSON.stringify(themeToVsCode(theme, appearance), null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = vsCodeThemeFileName(theme, appearance)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ColorThemeSettings() {
  const colorTheme = useSettings((state) => state.colorTheme)
  const customThemes = useSettings((state) => state.customThemes)
  const instanceThemes = useSettings((state) => state.instanceThemes)
  const set = useSettings((state) => state.set)
  return (
    <ColorThemePicker
      selectedId={colorTheme}
      editableThemes={customThemes}
      instanceThemes={instanceThemes}
      onSelect={(id) => set('colorTheme', id)}
      onEdit={(update) => useSettings.setState((state) => ({ customThemes: update(state.customThemes) }))}
    />
  )
}

/** Pick, create, import, export, and edit color themes. */
export function ColorThemePicker({
  selectedId, editableThemes, instanceThemes, onSelect, onEdit, scope = 'personal',
}: {
  selectedId: string
  editableThemes: CustomTheme[]
  instanceThemes?: CustomTheme[]
  onSelect: (id: string) => void
  onEdit: (update: (themes: CustomTheme[]) => CustomTheme[]) => void
  scope?: 'personal' | 'instance'
}) {
  const activeAppearance = useActiveAppearance()
  const fileInput = useRef<HTMLInputElement>(null)
  const headingId = useId()
  const [message, setMessage] = useState<{ kind: 'error' | 'status'; text: string } | null>(null)
  const editingInstance = scope === 'instance'
  const pickerId = (id: string) => editingInstance ? INSTANCE_COLOR_THEME_PREFIX + id : id
  const themes = editingInstance ? allColorThemes([], editableThemes) : allColorThemes(editableThemes, instanceThemes)
  const selected = themes.find((theme) => theme.id === selectedId) ?? themes[0]!
  const selectedCustom = editableThemes.find((theme) => pickerId(theme.id) === selected.id)
  const atLimit = editableThemes.length >= CUSTOM_THEMES_MAX

  const addTheme = (theme: Omit<CustomTheme, 'id'>) => {
    const created = { ...theme, id: newCustomThemeId() }
    onEdit((themes) => themes.length < CUSTOM_THEMES_MAX ? [...themes, created] : themes)
    onSelect(pickerId(created.id))
  }

  const updateSelected = (patch: Partial<Omit<CustomTheme, 'id'>>) => {
    onEdit((themes) => themes.map((theme) => theme.id === selectedCustom?.id ? { ...theme, ...patch } : theme))
  }

  const duplicate = () => {
    setMessage(null)
    addTheme({
      name: uit`${selected.name} copy`.slice(0, THEME_NAME_MAX_LENGTH),
      light: structuredClone(selected.light),
      dark: structuredClone(selected.dark),
      css: selected.css,
    })
  }

  const remove = () => {
    if (!selectedCustom || !window.confirm(uit`Delete the “${selectedCustom.name}” theme? This can’t be undone.`)) return
    setMessage(null)
    onEdit((themes) => themes.filter((theme) => theme.id !== selectedCustom.id))
    onSelect(DEFAULT_COLOR_THEME_ID)
  }

  const importFile = async (file: File) => {
    const result = await readThemeFile(file)
    if (!result.ok) {
      setMessage({ kind: 'error', text: importError(result) })
      return
    }
    const other: ThemeAppearance = result.appearance === 'dark' ? 'light' : 'dark'
    const variants = {
      [result.appearance]: result.pulpo?.[result.appearance] ?? result.variant,
      [other]: result.pulpo?.[other] ?? EMPTY_VARIANT,
    } as Record<ThemeAppearance, ThemeVariant>
    addTheme({ name: result.name, light: variants.light, dark: variants.dark, css: editingInstance ? '' : result.pulpo?.css ?? '' })
    const both = Boolean(result.pulpo?.light && result.pulpo?.dark)
    const note = both
      ? uit`Imported “${result.name}”.`
      : result.appearance === 'dark'
        ? uit`Imported “${result.name}” as dark colors. Its light colors are Pulpo’s until you import a light theme into it.`
        : uit`Imported “${result.name}” as light colors. Its dark colors are Pulpo’s until you import a dark theme into it.`
    const notes = [note]
    if (result.partial) notes.push(ui('It builds on another theme file, so some colors may be missing.'))
    if (editingInstance && result.pulpo?.css) notes.push(ui('Instance themes import colors only. Custom CSS was omitted.'))
    setMessage({ kind: 'status', text: notes.join(' ') })
  }

  return (
    <div className="py-3">
      <div id={headingId} className="text-sm font-medium">{ui('Color theme')}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">{ui('Themes use VS Code’s color theme format, so you can import VS Code themes and export yours to VS Code. Each has light and dark colors.')}</p>
      <div role="group" aria-labelledby={headingId} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {themes.map((theme) => {
          const isSelected = theme.id === selected.id
          return (
            <button
              key={theme.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => { setMessage(null); onSelect(theme.id) }}
              className={cn(
                'min-w-0 cursor-pointer rounded-lg border p-1.5 text-left transition-colors hover:bg-accent/60',
                isSelected && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
              )}
            >
              <ThemePreview theme={theme} appearance={activeAppearance} />
              <span className="mt-1.5 flex items-center gap-1 px-0.5 text-sm">
                <span className="min-w-0 truncate">{theme.name}</span>
                {isSelected && <Check className="size-3.5 shrink-0" aria-hidden />}
              </span>
              {!editingInstance && theme.id.startsWith(INSTANCE_COLOR_THEME_PREFIX) && (
                <span className="block px-0.5 text-xs text-muted-foreground">{ui('Instance theme')}</span>
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={atLimit} onClick={duplicate}>
          <Copy className="size-3.5" aria-hidden />{ui('Duplicate')}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={atLimit} onClick={() => fileInput.current?.click()}>
          <Upload className="size-3.5" aria-hidden />{ui('Import')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Download className="size-3.5" aria-hidden />{ui('Export')}<ChevronDown className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => downloadVsCodeTheme(selected, 'dark')}>{ui('Dark VS Code theme')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => downloadVsCodeTheme(selected, 'light')}>{ui('Light VS Code theme')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {selectedCustom && (
          <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={remove}>
            <Trash2 className="size-3.5" aria-hidden />{ui('Delete')}
          </Button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".json,.jsonc,application/json"
          className="hidden"
          data-testid="theme-import"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void importFile(file)
          }}
        />
      </div>
      {atLimit && <p className="mt-2 text-xs text-muted-foreground">{uit`You can keep up to ${CUSTOM_THEMES_MAX} custom themes. Delete one to add another.`}</p>}
      {message?.kind === 'error' && <p role="alert" className="mt-2 text-xs text-destructive">{message.text}</p>}
      <p role="status" className={cn('mt-2 text-xs text-muted-foreground', message?.kind !== 'status' && 'sr-only')}>
        {message?.kind === 'status' ? message.text : ''}
      </p>
      {selectedCustom ? (
        <div className="mt-4 border-t pt-3">
          <ThemeEditor key={selectedCustom.id} theme={selectedCustom} activeAppearance={activeAppearance} allowCss={!editingInstance} onUpdate={updateSelected} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          {editingInstance
            ? ui('Duplicate a built-in theme or import a file to create an instance theme.')
            : selected.builtIn
              ? uit`${selected.name} is built in. Duplicate it to change its colors or add custom CSS.`
              : ui('This theme is managed by your instance admin. Duplicate it to make your own copy.')}
        </p>
      )}
    </div>
  )
}
