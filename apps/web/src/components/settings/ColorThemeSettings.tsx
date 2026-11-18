import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import {
  CUSTOM_THEMES_MAX,
  DEFAULT_COLOR_THEME_ID,
  THEME_BASE_COLOR_ROLES,
  THEME_CSS_MAX_LENGTH,
  THEME_NAME_MAX_LENGTH,
  unsafeThemeCssReason,
  type CustomTheme,
  type ThemeAppearance,
  type ThemeColorRole,
} from '@pulpo/contracts'
import { Check, ChevronRight, Copy, Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { normalizeHex } from '@/lib/color'
import {
  allColorThemes,
  findColorTheme,
  newCustomThemeId,
  parseThemeFile,
  resolvePalette,
  themeFileName,
  themeToFile,
  type ColorTheme,
} from '@/lib/color-themes'
import { cn } from '@/lib/utils'
import { ui, uit } from '@/i18n/ui'
import { useTranslation } from '@/i18n/useAppTranslation'
import { useSettings } from '@/stores/settings'

const ROLE_GROUPS: { id: 'foundation' | 'content' | 'sidebar' | 'status'; roles: ThemeColorRole[] }[] = [
  { id: 'foundation', roles: ['background', 'surface', 'raisedSurface', 'hover', 'text', 'mutedText', 'border', 'input'] },
  { id: 'content', roles: ['action', 'focus', 'messageSurface', 'codeSurface'] },
  { id: 'sidebar', roles: ['sidebar', 'sidebarSelection', 'sidebarBorder'] },
  { id: 'status', roles: ['error'] },
]

const BASE_ROLES = new Set<ThemeColorRole>(THEME_BASE_COLOR_ROLES)
const CSS_PLACEHOLDER = '.dark [data-slot="button"] {\n  border-radius: 999px;\n}'

function groupLabel(group: (typeof ROLE_GROUPS)[number]['id']): string {
  switch (group) {
    case 'foundation': return ui('Foundation')
    case 'content': return ui('Brand & content')
    case 'sidebar': return ui('Sidebar')
    case 'status': return ui('Status')
  }
}

function roleLabel(role: ThemeColorRole): string {
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
    case 'focus': return ui('Focus ring')
    case 'messageSurface': return ui('Your messages')
    case 'codeSurface': return ui('Code blocks')
    case 'sidebar': return ui('Sidebar background')
    case 'sidebarSelection': return ui('Sidebar selection')
    case 'sidebarBorder': return ui('Sidebar border')
    case 'error': return ui('Error')
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
  return (
    <Input
      aria-label={label}
      value={focused ? draft : value}
      spellCheck={false}
      autoComplete="off"
      maxLength={7}
      className={cn('h-8 w-24 font-mono text-sm', derived && !focused && 'text-muted-foreground')}
      onFocus={() => { setDraft(value); setFocused(true) }}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        setDraft(event.target.value)
        const hex = normalizeHex(event.target.value)
        if (hex && event.target.value.replace('#', '').length === 6) onCommit(hex)
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

function ColorRow({ role, value, derived, canReset, onChange, onReset }: {
  role: ThemeColorRole
  value: string
  derived: boolean
  canReset: boolean
  onChange: (hex: string) => void
  onReset: () => void
}) {
  const label = roleLabel(role)
  return (
    <div className="flex min-w-0 items-center gap-3 py-1.5 pl-2">
      <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{label}</div>
      {canReset && (
        <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label={uit`Reset ${label}`} title={ui('Reset to the derived color')} onClick={onReset}>
          <RotateCcw className="size-3.5" aria-hidden />
        </Button>
      )}
      <div className="relative size-7 shrink-0">
        <input
          type="color"
          aria-label={uit`Pick ${label}`}
          value={value}
          className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
          onChange={(event) => onChange(event.currentTarget.value)}
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

function ThemeEditor({ theme, activeAppearance, onUpdate }: {
  theme: CustomTheme
  activeAppearance: ThemeAppearance
  onUpdate: (patch: Partial<Omit<CustomTheme, 'id'>>) => void
}) {
  const id = useId()
  const [appearance, setAppearance] = useState<ThemeAppearance>(activeAppearance)
  const [advanced, setAdvanced] = useState(false)
  const [filter, setFilter] = useState('')
  const [name, setName] = useState(theme.name)
  const [css, setCss] = useState(theme.css)
  const [cssOpen, setCssOpen] = useState(Boolean(theme.css.trim()))

  // Edit what's on screen: switching the app between light and dark switches the editor too.
  useEffect(() => setAppearance(activeAppearance), [activeAppearance])
  // Another device (or an import) can change the theme under the editor.
  useEffect(() => setName(theme.name), [theme.name])
  useEffect(() => setCss(theme.css), [theme.css])

  const colors = theme[appearance]
  const palette = resolvePalette(colors, appearance)
  const query = filter.trim().toLowerCase()
  const groups = ROLE_GROUPS.map((group) => ({
    ...group,
    roles: group.roles.filter((role) => (advanced || BASE_ROLES.has(role)) && (!query || roleLabel(role).toLowerCase().includes(query))),
  })).filter((group) => group.roles.length)
  const hiddenOverrides = advanced ? 0 : Object.keys(colors).filter((role) => !BASE_ROLES.has(role as ThemeColorRole)).length
  const cssError = css.length > THEME_CSS_MAX_LENGTH
    ? uit`Theme CSS can be up to ${THEME_CSS_MAX_LENGTH.toLocaleString()} characters.`
    : (unsafeThemeCssReason(css) ? ui('Theme CSS can’t load anything from the internet: no @import, and url() only with data: or #id.') : '')

  const setColor = (role: ThemeColorRole, hex: string | null) => {
    const next = { ...colors }
    if (hex) next[role] = hex
    else delete next[role]
    onUpdate({ [appearance]: next })
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
          {appearance !== activeAppearance && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {appearance === 'light' ? ui('Switch Theme to Light to preview these colors.') : ui('Switch Theme to Dark to preview these colors.')}
            </p>
          )}
        </div>
        <SegmentedAppearance value={appearance} onChange={setAppearance} labelledBy={`${id}-appearance`} />
      </div>
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
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`${id}-${group.id}`} className="pt-2">
          {advanced && <h4 id={`${id}-${group.id}`} className="py-1 text-sm font-medium">{groupLabel(group.id)}</h4>}
          {!advanced && <h4 id={`${id}-${group.id}`} className="sr-only">{groupLabel(group.id)}</h4>}
          {group.roles.map((role) => (
            <ColorRow
              key={`${appearance}-${role}`}
              role={role}
              value={palette[role]}
              derived={!colors[role]}
              canReset={advanced && Boolean(colors[role]) && !BASE_ROLES.has(role)}
              onChange={(hex) => setColor(role, hex)}
              onReset={() => setColor(role, null)}
            />
          ))}
        </section>
      ))}
      {!groups.length && <p className="py-3 text-sm text-muted-foreground">{ui('No colors match.')}</p>}
      {!advanced && (
        <p className="pt-1 text-xs text-muted-foreground">
          {hiddenOverrides === 0
            ? ui('Other colors follow these three. Turn on Advanced to set them yourself.')
            : hiddenOverrides === 1
              ? ui('1 more color is set in Advanced.')
              : uit`${hiddenOverrides} more colors are set in Advanced.`}
        </p>
      )}
      <Collapsible open={cssOpen} onOpenChange={setCssOpen} className="pt-3">
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
      </Collapsible>
    </div>
  )
}

function downloadTheme(theme: ColorTheme) {
  const blob = new Blob([`${JSON.stringify(themeToFile(theme), null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = themeFileName(theme)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Pick, create, import, export, and edit color themes. */
export function ColorThemeSettings() {
  const colorTheme = useSettings((state) => state.colorTheme)
  const customThemes = useSettings((state) => state.customThemes)
  const set = useSettings((state) => state.set)
  const activeAppearance = useActiveAppearance()
  const fileInput = useRef<HTMLInputElement>(null)
  const headingId = useId()
  const [message, setMessage] = useState<{ kind: 'error' | 'status'; text: string } | null>(null)
  const themes = allColorThemes(customThemes)
  const selected = findColorTheme(colorTheme, customThemes)
  const selectedCustom = customThemes.find((theme) => theme.id === selected.id)
  const atLimit = customThemes.length >= CUSTOM_THEMES_MAX

  const addTheme = (theme: Omit<CustomTheme, 'id'>) => {
    const created = { ...theme, id: newCustomThemeId() }
    set('customThemes', [...useSettings.getState().customThemes, created])
    set('colorTheme', created.id)
  }

  const updateSelected = (patch: Partial<Omit<CustomTheme, 'id'>>) => {
    set('customThemes', useSettings.getState().customThemes.map((theme) => theme.id === selected.id ? { ...theme, ...patch } : theme))
  }

  const duplicate = () => {
    setMessage(null)
    addTheme({
      name: uit`${selected.name} copy`.slice(0, THEME_NAME_MAX_LENGTH),
      light: { ...selected.light },
      dark: { ...selected.dark },
      css: selected.css,
    })
  }

  const remove = () => {
    if (!selectedCustom || !window.confirm(uit`Delete the “${selectedCustom.name}” theme? This can’t be undone.`)) return
    setMessage(null)
    set('customThemes', customThemes.filter((theme) => theme.id !== selectedCustom.id))
    set('colorTheme', DEFAULT_COLOR_THEME_ID)
  }

  const importFile = async (file: File) => {
    if (file.size > 256 * 1024) {
      setMessage({ kind: 'error', text: ui('That file is too large to be a theme.') })
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      setMessage({ kind: 'error', text: ui('That file isn’t a Pulpo theme.') })
      return
    }
    const result = parseThemeFile(text)
    if (!result.ok) {
      setMessage({
        kind: 'error',
        text: result.reason === 'css'
          ? ui('This theme’s CSS loads content from the internet, so it wasn’t imported.')
          : ui('That file isn’t a Pulpo theme.'),
      })
      return
    }
    addTheme(result.theme)
    setMessage({ kind: 'status', text: uit`Imported “${result.theme.name}”.` })
  }

  return (
    <div className="py-3">
      <div id={headingId} className="text-sm font-medium">{ui('Color theme')}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">{ui('Each theme has light and dark colors. Duplicate a theme to customize it.')}</p>
      <div role="group" aria-labelledby={headingId} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {themes.map((theme) => {
          const isSelected = theme.id === selected.id
          return (
            <button
              key={theme.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => { setMessage(null); set('colorTheme', theme.id) }}
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
        <Button type="button" variant="outline" size="sm" onClick={() => downloadTheme(selected)}>
          <Download className="size-3.5" aria-hidden />{ui('Export')}
        </Button>
        {selectedCustom && (
          <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={remove}>
            <Trash2 className="size-3.5" aria-hidden />{ui('Delete')}
          </Button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
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
          <ThemeEditor key={selectedCustom.id} theme={selectedCustom} activeAppearance={activeAppearance} onUpdate={updateSelected} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{uit`${selected.name} is built in. Duplicate it to change its colors or add custom CSS.`}</p>
      )}
    </div>
  )
}
