import { useMemo, useRef, useState, type DragEvent } from 'react'
import { ChevronDown, Search, Star } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getCatalogModel, useCatalog } from '@/stores/catalog'
import { ModelIcon } from '@/components/ModelIcon'
import { ProviderLogo } from '@/components/ProviderLogo'
import { resolveProviderOrder, useModels } from '@/stores/models'
import { cn } from '@/lib/utils'
import { useSettings } from '@/stores/settings'

type DragKind = 'model' | 'provider'

export function ModelSelector({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<string | null>(null) // null = favorites
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragKind, setDragKind] = useState<DragKind | null>(null)
  const [drop, setDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const dragKindRef = useRef<DragKind | null>(null)
  const didDragRef = useRef(false)
  const favorites = useModels((s) => s.favoriteModelIds)
  const providerOrder = useModels((s) => s.providerOrder)
  const toggleFavorite = useModels((s) => s.toggleFavorite)
  const reorderFavorites = useModels((s) => s.reorderFavorites)
  const reorderProviders = useModels((s) => s.reorderProviders)
  const catalogModels = useCatalog((state) => state.models)
  const defaultModelId = useSettings((state) => state.defaultModelId)
  const setSetting = useSettings((state) => state.set)
  const selected = catalogModels.find((m) => m.id === value) ?? getCatalogModel(value)

  const enabled = useMemo(() => catalogModels.filter((m) => m.enabled), [catalogModels])
  const availableProviders = useMemo(() => [...new Set(enabled.map((model) => model.providerGroupId))], [enabled])
  const providers = useMemo(() => resolveProviderOrder(providerOrder, availableProviders), [providerOrder, availableProviders])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) return enabled.filter((m) => m.name.toLowerCase().includes(q))
    if (provider === null) {
      return favorites
        .map((id) => enabled.find((m) => m.id === id))
        .filter((m): m is (typeof enabled)[number] => !!m)
    }
    return enabled.filter((m) => m.providerGroupId === provider)
  }, [provider, query, favorites, enabled])

  const searching = query.trim().length > 0
  // logos next to models on favorites (and search); no logos when a provider is selected
  const showLogos = provider === null || searching
  const favoritesActive = provider === null && !searching
  const canReorderModels = favoritesActive && rows.length > 1
  const canReorderProviders = providers.length > 1

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  const clearDrag = () => {
    dragIdRef.current = null
    dragKindRef.current = null
    setDragId(null)
    setDragKind(null)
    setDrop(null)
  }

  const startDrag = (kind: DragKind, id: string, e: DragEvent) => {
    didDragRef.current = false
    dragIdRef.current = id
    dragKindRef.current = kind
    setDragId(id)
    setDragKind(kind)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const onItemDragOver = (kind: DragKind, id: string, e: DragEvent<HTMLElement>) => {
    if (dragKindRef.current !== kind || !dragIdRef.current || dragIdRef.current === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    didDragRef.current = true
    const rect = e.currentTarget.getBoundingClientRect()
    const edge = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    if (drop?.id !== id || drop.edge !== edge) setDrop({ id, edge })
  }

  return (
    <div className="relative min-w-0">
      <DropdownMenu
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) {
            setQuery('')
            setProvider(null)
            clearDrag()
          }
        }}
      >
      <DropdownMenuTrigger asChild>
        <button className="flex max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
          <ProviderLogo
            provider={selected.provider}
            icon={selected.labLogo}
            customIcon={selected.labCustomIcon}
            className="size-5 shrink-0"
          />
          <span className="min-w-0 truncate">{selected.name}</span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180'
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[300px] p-0">
        {/* search */}
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models…"
            className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex h-[264px] min-h-0">
          {/* provider rail */}
          <div className="flex min-h-0 flex-col items-center gap-0.5 overflow-y-auto border-r px-1.5 py-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setProvider(null)}
                  className={cn(
                    'group/star flex size-8 cursor-pointer items-center justify-center bg-transparent shadow-none outline-none ring-0 transition-transform duration-150 hover:bg-transparent focus:bg-transparent focus-visible:ring-0',
                    favoritesActive
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-amber-500'
                  )}
                  aria-label="Favorites"
                >
                  <Star
                    className="size-4 fill-none stroke-current transition-colors duration-150 group-hover/star:stroke-amber-500"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Favorites</TooltipContent>
            </Tooltip>

            <div className="my-1 h-px w-5 bg-border" />

            {providers.map((p) => {
              const active = provider === p && !searching
              const isDragging = dragKind === 'provider' && dragId === p
              const showLineBefore =
                dragKind === 'provider' && drop?.id === p && drop.edge === 'before' && !isDragging
              const showLineAfter =
                dragKind === 'provider' && drop?.id === p && drop.edge === 'after' && !isDragging
              return (
                <Tooltip key={p}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      draggable={canReorderProviders}
                      onDragStart={(e) => {
                        if (!canReorderProviders) return
                        startDrag('provider', p, e)
                      }}
                      onDragOver={(e) => onItemDragOver('provider', p, e)}
                      onDrop={(e) => {
                        e.preventDefault()
                        if (dragKindRef.current !== 'provider') return
                        const from = dragIdRef.current ?? e.dataTransfer.getData('text/plain')
                        const edge = drop?.id === p ? drop.edge : 'before'
                        if (from) reorderProviders(from, p, edge, availableProviders)
                        clearDrag()
                      }}
                      onDragEnd={clearDrag}
                      onClick={() => {
                        if (didDragRef.current) {
                          didDragRef.current = false
                          return
                        }
                        setProvider(p)
                      }}
                      className={cn(
                        'group/prov relative flex size-8 cursor-pointer items-center justify-center rounded-lg transition-all duration-150',
                        active
                          ? 'bg-accent text-foreground shadow-sm ring-1 ring-border/60'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        isDragging && 'opacity-40'
                      )}
                      aria-label={p}
                    >
                      {showLineBefore && (
                        <div className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded-full bg-foreground/35" />
                      )}
                      {showLineAfter && (
                        <div className="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-foreground/35" />
                      )}
                      <ProviderLogo
                        provider={enabled.find((m) => m.providerGroupId === p)?.provider ?? p}
                        icon={enabled.find((m) => m.providerGroupId === p)?.labLogo}
                        customIcon={enabled.find((m) => m.providerGroupId === p)?.labCustomIcon}
                        variant={active ? 'filled' : 'outline'}
                        className={cn(
                          'size-[18px] transition-opacity duration-150',
                          !active && 'group-hover/prov:opacity-100'
                        )}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{enabled.find((m) => m.providerGroupId === p)?.provider ?? p}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>

          {/* model list */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-1.5">
            {rows.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {provider === null && !searching ? 'No favorites yet' : 'No models found'}
              </div>
            )}
            {rows.map((m) => {
              const isFav = favorites.includes(m.id)
              const isSelected = m.id === value
              const isDragging = dragKind === 'model' && dragId === m.id
              const showLineBefore =
                dragKind === 'model' && drop?.id === m.id && drop.edge === 'before' && !isDragging
              const showLineAfter =
                dragKind === 'model' && drop?.id === m.id && drop.edge === 'after' && !isDragging
              return (
                <div
                  key={m.id}
                  draggable={canReorderModels}
                  onDragStart={(e) => {
                    if (!canReorderModels) return
                    startDrag('model', m.id, e)
                  }}
                  onDragOver={(e) => onItemDragOver('model', m.id, e)}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragKindRef.current !== 'model') return
                    const from = dragIdRef.current ?? e.dataTransfer.getData('text/plain')
                    const edge = drop?.id === m.id ? drop.edge : 'before'
                    if (from) reorderFavorites(from, m.id, edge)
                    clearDrag()
                  }}
                  onDragEnd={clearDrag}
                  className={cn(
                    'group relative flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors',
                    isSelected ? 'bg-accent/70' : 'hover:bg-accent',
                    isDragging && 'opacity-40'
                  )}
                  onClick={() => {
                    if (dragIdRef.current || didDragRef.current) {
                      didDragRef.current = false
                      return
                    }
                    pick(m.id)
                  }}
                >
                  {showLineBefore && (
                    <div className="pointer-events-none absolute inset-x-2 -top-px h-0.5 rounded-full bg-foreground/35" />
                  )}
                  {showLineAfter && (
                    <div className="pointer-events-none absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground/35" />
                  )}
                  {showLogos && (
                    <ModelIcon model={m} className="size-[18px] rounded-[3px]" boxed={false} />
                  )}
                  <span className="flex-1 truncate text-left text-sm">{m.name}</span>

                  {/* favorite star — stronger hover */}
                  <button
                    className={cn(
                      'group/favorite flex size-7 cursor-pointer items-center justify-center bg-transparent transition-colors duration-150',
                      isFav
                        ? 'opacity-100 text-amber-400'
                        : 'opacity-0 text-muted-foreground group-hover:opacity-100 hover:text-amber-500'
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFavorite(m.id)
                    }}
                    aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star
                      className={cn(
                        'size-3.5 fill-transparent transition-all duration-150',
                        isFav
                          ? 'fill-amber-400 text-amber-400 group-hover/favorite:fill-transparent group-hover/favorite:text-amber-400'
                          : 'group-hover/favorite:fill-amber-400 group-hover/favorite:text-amber-500'
                      )}
                    />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </DropdownMenuContent>
      </DropdownMenu>
      {value && value !== defaultModelId && (
        <button
          type="button"
          className="absolute left-9 top-7 cursor-pointer whitespace-nowrap text-[11px] leading-4 text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setSetting('defaultModelId', value)}
        >
          Set as default
        </button>
      )}
    </div>
  )
}
