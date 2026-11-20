import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ListChecks, Search, Star } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ModelIcon } from '@/components/ModelIcon'
import { ProviderLogo } from '@/components/ProviderLogo'
import { getCatalogModel } from '@/stores/catalog'
import { resolveProviderOrder, useModels } from '@/stores/models'
import { CODEX_LAB_ID } from '@/lib/catalog-model'
import type { Model } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ui, uit } from '@/i18n/ui'

const SELECTED_TAB = '\u0000selected'
const FAVORITES_TAB = '\u0000favorites'
const railFocusRing = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

type Row = { model: Model; unavailable: boolean }

/**
 * Inline multi-select version of the chat model picker: search, a provider rail, and checkable rows.
 * Selected ids missing from `models` stay listed under Selected so they can still be removed.
 */
export function ModelMultiPicker({ models, value, onChange, label }: {
  models: Model[]
  value: string[]
  onChange: (ids: string[]) => void
  label: string
}) {
  const baseId = useId()
  const listboxId = `${baseId}-models`
  const hintId = `${baseId}-hint`
  const favorites = useModels((state) => state.favoriteModelIds)
  const providerOrder = useModels((state) => state.providerOrder)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [keyboardNav, setKeyboardNav] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const selected = new Set(value)

  const availableProviders = useMemo(() => [...new Set(models.map((model) => model.providerGroupId).filter((id) => id !== CODEX_LAB_ID))], [models])
  const providers = useMemo(() => resolveProviderOrder(providerOrder, availableProviders), [providerOrder, availableProviders])
  const hasCodex = models.some((model) => model.providerGroupId === CODEX_LAB_ID)
  const favoriteModels = favorites.flatMap((id) => models.find((model) => model.id === id) ?? [])
  const railTabs = [SELECTED_TAB, ...(favoriteModels.length ? [FAVORITES_TAB] : []), ...(hasCodex ? [CODEX_LAB_ID] : []), ...providers]
  const [tab, setTab] = useState(() => value.length ? SELECTED_TAB : favoriteModels.length ? FAVORITES_TAB : providers[0] ?? SELECTED_TAB)
  const currentTab = railTabs.includes(tab) ? tab : SELECTED_TAB

  const searching = query.trim().length > 0
  const rows: Row[] = (() => {
    const q = query.trim().toLowerCase()
    if (q) return models.filter((model) => model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q)).map((model) => ({ model, unavailable: false }))
    if (currentTab === SELECTED_TAB) {
      return value.map((id) => {
        const model = models.find((candidate) => candidate.id === id)
        return model ? { model, unavailable: false } : { model: { ...getCatalogModel(id), id, name: id }, unavailable: true }
      })
    }
    if (currentTab === FAVORITES_TAB) return favoriteModels.map((model) => ({ model, unavailable: false }))
    return models.filter((model) => model.providerGroupId === currentTab).map((model) => ({ model, unavailable: false }))
  })()
  const showLogos = searching || currentTab === SELECTED_TAB || currentTab === FAVORITES_TAB
  const activeIndex = (() => {
    const index = rows.findIndex((row) => row.model.id === activeId)
    return index >= 0 ? index : rows.length ? 0 : -1
  })()
  const optionId = (index: number) => `${baseId}-option-${index}`
  const activeOptionId = activeIndex >= 0 ? optionId(activeIndex) : undefined
  const showKeyboardCursor = keyboardNav && searchFocused
  const providerModel = (id: string) => models.find((model) => model.providerGroupId === id)
  const tabName = (key: string) => key === SELECTED_TAB ? ui('Selected models')
    : key === FAVORITES_TAB ? ui('Favorites')
      : key === CODEX_LAB_ID ? ui('Codex')
        : providerModel(key)?.provider ?? ui('Provider')
  const emptyText = searching ? ui('No models match your search.')
    : currentTab === SELECTED_TAB ? ui('No models selected yet. Search or pick a provider to add some.')
      : ui('No models')

  useEffect(() => {
    if (!showKeyboardCursor || !activeOptionId) return
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' })
  }, [showKeyboardCursor, activeOptionId])

  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id])

  const showTab = (key: string) => {
    setTab(key)
    setQuery('')
    setActiveId(null)
  }

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    setKeyboardNav(true)
    const move = (index: number) => {
      const next = rows[Math.min(Math.max(index, 0), rows.length - 1)]
      if (next) setActiveId(next.model.id)
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(activeIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(activeIndex - 1)
    } else if (event.key === 'Enter') {
      // Inside a form, Enter would otherwise submit it.
      event.preventDefault()
      const row = rows[activeIndex]
      if (row) {
        setActiveId(row.model.id)
        toggle(row.model.id)
      }
    }
  }

  const onRailKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = railTabs.findIndex((key) => tabRefs.current.get(key) === event.target)
    if (index < 0) return
    let next = -1
    if (event.key === 'ArrowDown') next = (index + 1) % railTabs.length
    else if (event.key === 'ArrowUp') next = (index - 1 + railTabs.length) % railTabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = railTabs.length - 1
    if (next < 0) return
    event.preventDefault()
    tabRefs.current.get(railTabs[next])?.focus()
    showTab(railTabs[next])
  }

  const railTab = (key: string, icon: ReactNode) => {
    const active = currentTab === key && !searching
    return (
      <Tooltip key={key}>
        <TooltipTrigger asChild>
          <button
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={listboxId}
            aria-label={key === SELECTED_TAB ? uit`Selected models (${value.length})` : tabName(key)}
            tabIndex={key === currentTab ? 0 : -1}
            ref={(node) => {
              if (node) tabRefs.current.set(key, node)
              else tabRefs.current.delete(key)
            }}
            onClick={() => showTab(key)}
            className={cn(
              'group/prov relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-all duration-150',
              railFocusRing,
              active
                ? 'bg-accent text-foreground shadow-sm ring-1 ring-border/60'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {icon}
            {key === SELECTED_TAB && value.length > 0 && (
              <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-medium leading-4 text-primary-foreground tabular-nums">
                {value.length}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{tabName(key)}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div role="group" aria-label={label} className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-4 text-muted-foreground" aria-hidden="true" />
        <input
          value={query}
          role="combobox"
          aria-label={ui('Search models')}
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={showKeyboardCursor ? activeOptionId : undefined}
          aria-describedby={hintId}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveId(null)
          }}
          onKeyDown={onSearchKeyDown}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder={ui('Search models…')}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <p id={hintId} hidden>{ui('Use the up and down arrow keys to browse models and Enter to select or deselect one. Press Tab to reach the providers.')}</p>
      <div role="status" className="sr-only">{searching ? rows.length === 1 ? ui('1 model') : uit`${rows.length} models` : ''}</div>

      <div className="flex h-[264px] min-h-0">
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label={ui('Model providers')}
          onKeyDown={onRailKeyDown}
          className="flex min-h-0 flex-col items-center gap-0.5 overflow-y-auto border-r px-1.5 py-2"
        >
          {railTab(SELECTED_TAB, <ListChecks aria-hidden="true" className="size-4" />)}
          {favoriteModels.length > 0 && railTab(FAVORITES_TAB, <Star aria-hidden="true" className="size-4" />)}
          <div className="my-1 h-px w-5 shrink-0 bg-border" aria-hidden="true" />
          {hasCodex && railTab(CODEX_LAB_ID, (
            <ProviderLogo provider={ui('Codex')} icon="codex" variant={currentTab === CODEX_LAB_ID && !searching ? 'filled' : 'outline'} className="size-[18px]" />
          ))}
          {providers.map((key) => {
            const model = providerModel(key)
            return railTab(key, (
              <ProviderLogo
                provider={tabName(key)}
                icon={model?.labLogo}
                customIcon={model?.labCustomIcon}
                variant={currentTab === key && !searching ? 'filled' : 'outline'}
                className="size-[18px]"
              />
            ))
          })}
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-1.5">
          {rows.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted-foreground">{emptyText}</div>}
          <div
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={searching ? ui('Search results') : tabName(currentTab)}
          >
            {rows.map(({ model, unavailable }, index) => {
              const checked = selected.has(model.id)
              const isActive = index === activeIndex
              return (
                <div
                  key={model.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={checked}
                  aria-label={unavailable ? uit`${model.name}, unavailable` : model.name}
                  onPointerMove={() => {
                    if (keyboardNav) setKeyboardNav(false)
                    if (activeId !== model.id) setActiveId(model.id)
                  }}
                  onClick={() => toggle(model.id)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent',
                    isActive && showKeyboardCursor && 'bg-accent ring-2 ring-inset ring-ring/50'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                      checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-transparent'
                    )}
                  >
                    {checked && <Check className="size-3" />}
                  </span>
                  {showLogos && <ModelIcon model={model} className="size-[18px] rounded-[3px]" boxed={false} />}
                  <span className={cn('min-w-0 flex-1 truncate text-left text-sm', unavailable && 'text-muted-foreground')}>{model.name}</span>
                  {unavailable && <span className="shrink-0 text-[11px] text-muted-foreground">{ui('Unavailable')}</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
