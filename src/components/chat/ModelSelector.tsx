import { useMemo, useState } from 'react'
import { ChevronDown, Search, Star } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MODELS } from '@/lib/mock'
import { ModelIcon } from '@/components/ModelIcon'
import { ProviderLogo } from '@/components/ProviderLogo'
import { PROVIDERS, useModels } from '@/stores/models'
import { cn } from '@/lib/utils'

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
  const favorites = useModels((s) => s.favorites)
  const toggleFavorite = useModels((s) => s.toggleFavorite)
  const selected = MODELS.find((m) => m.id === value) ?? MODELS[0]

  const enabled = MODELS.filter((m) => m.enabled)
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list =
      provider === null
        ? enabled.filter((m) => favorites.includes(m.id))
        : enabled.filter((m) => m.provider === provider)
    if (q) list = enabled.filter((m) => m.name.toLowerCase().includes(q))
    return list
  }, [provider, query, favorites, enabled])

  const searching = query.trim().length > 0
  // logos next to models on favorites (and search); no logos when a provider is selected
  const showLogos = provider === null || searching
  const favoritesActive = provider === null && !searching

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) {
          setQuery('')
          setProvider(null)
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
          <ProviderLogo
            provider={selected.provider}
            icon={selected.labLogo}
            className="size-5"
          />
          <span>{selected.name}</span>
          <ChevronDown
            className={cn(
              'size-3.5 text-muted-foreground transition-transform duration-200',
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
          <div className="flex flex-col items-center gap-0.5 border-r px-1.5 py-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setProvider(null)}
                  className={cn(
                    'group/star flex size-8 cursor-pointer items-center justify-center bg-transparent shadow-none outline-none ring-0 transition-transform duration-150 hover:bg-transparent focus:bg-transparent focus-visible:ring-0',
                    favoritesActive
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:scale-110 hover:text-amber-500'
                  )}
                  aria-label="Favorites"
                >
                  <Star
                    className="size-4 fill-none stroke-current transition-all duration-150 group-hover/star:scale-110 group-hover/star:stroke-amber-500"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Favorites</TooltipContent>
            </Tooltip>

            <div className="my-1 h-px w-5 bg-border" />

            {PROVIDERS.map((p) => {
              const active = provider === p && !searching
              return (
                <Tooltip key={p}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setProvider(p)}
                      className={cn(
                        'group/prov flex size-8 cursor-pointer items-center justify-center rounded-lg transition-all duration-150',
                        active
                          ? 'bg-accent text-foreground shadow-sm ring-1 ring-border/60'
                          : 'text-muted-foreground hover:scale-105 hover:bg-accent hover:text-foreground'
                      )}
                      aria-label={p}
                    >
                      <ProviderLogo
                        provider={p}
                        icon={enabled.find((m) => m.provider === p)?.labLogo}
                        variant={active ? 'filled' : 'outline'}
                        className={cn(
                          'size-[18px] transition-transform duration-150',
                          !active && 'group-hover/prov:scale-110'
                        )}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{p}</TooltipContent>
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
              return (
                <div
                  key={m.id}
                  className={cn(
                    'group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors',
                    isSelected ? 'bg-accent/70' : 'hover:bg-accent'
                  )}
                  onClick={() => pick(m.id)}
                >
                  {showLogos && (
                    <ModelIcon model={m} className="size-[18px] rounded-[3px]" boxed={false} />
                  )}
                  <span className="flex-1 truncate text-left text-sm">{m.name}</span>

                  {/* favorite star — stronger hover */}
                  <button
                    className={cn(
                      'group/favorite flex size-7 cursor-pointer items-center justify-center bg-transparent transition-all duration-150 hover:scale-110',
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
  )
}
