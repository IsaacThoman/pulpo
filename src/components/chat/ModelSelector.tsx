import { useMemo, useState } from 'react'
import { Check, ChevronDown, Search, Star } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MODELS } from '@/lib/mock'
import { ModelIcon } from '@/components/ModelIcon'
import { PROVIDERS, providerModel, providerMonogram, useModels } from '@/stores/models'
import { cn } from '@/lib/utils'

/** provider monogram — theme-aware colored square, matches the brutalist icon style */
function ProviderMark({ provider, className }: { provider: string; className?: string }) {
  const rep = providerModel(provider)
  return (
    <span
      className={cn(
        'relative flex size-5 items-center justify-center overflow-hidden rounded-[3px] text-[9px] font-bold',
        className
      )}
      aria-hidden
    >
      <span className="absolute inset-0 dark:hidden" style={{ backgroundColor: rep.iconLight }} />
      <span className="absolute inset-0 hidden dark:block" style={{ backgroundColor: rep.iconDark }} />
      <span className="relative text-white mix-blend-difference">{providerMonogram(provider)}</span>
    </span>
  )
}

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
    let list = provider === null ? enabled.filter((m) => favorites.includes(m.id)) : enabled.filter((m) => m.provider === provider)
    if (q) list = enabled.filter((m) => m.name.toLowerCase().includes(q))
    return list
  }, [provider, query, favorites, enabled])

  const searching = query.trim().length > 0
  const showLogos = provider === null || searching

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
        <button className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-accent">
          <ModelIcon model={selected} className="size-5 rounded-[3px]" />
          <span>{selected.name}</span>
          <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
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

        <div className="flex">
          {/* provider rail */}
          <div className="flex flex-col items-center gap-1 border-r py-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setProvider(null)}
                  className={cn(
                    'flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors',
                    provider === null && !searching
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  )}
                  aria-label="Favorites"
                >
                  <Star className={cn('size-4', provider === null && !searching && 'fill-current')} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Favorites</TooltipContent>
            </Tooltip>
            <div className="my-0.5 h-px w-5 bg-border" />
            {PROVIDERS.map((p) => (
              <Tooltip key={p}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setProvider(p)}
                    className={cn(
                      'flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors',
                      provider === p && !searching
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    )}
                    aria-label={p}
                  >
                    <ProviderMark provider={p} className="size-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{p}</TooltipContent>
              </Tooltip>
            ))}
          </div>

          {/* model list */}
          <div className="max-h-[320px] min-w-0 flex-1 overflow-y-auto p-1.5">
            {rows.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {provider === null && !searching ? 'No favorites yet' : 'No models found'}
              </div>
            )}
            {rows.map((m) => (
              <div
                key={m.id}
                className="group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent"
                onClick={() => pick(m.id)}
              >
                {showLogos && <ModelIcon model={m} className="size-[18px] rounded-[3px]" />}
                <span className="flex-1 truncate text-left text-sm">{m.name}</span>
                <button
                  className={cn(
                    'cursor-pointer rounded p-0.5 text-muted-foreground transition-opacity hover:text-foreground',
                    favorites.includes(m.id)
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100'
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(m.id)
                  }}
                  aria-label={favorites.includes(m.id) ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Star
                    className={cn(
                      'size-3.5',
                      favorites.includes(m.id) && 'fill-amber-400 text-amber-400'
                    )}
                  />
                </button>
                {m.id === value && <Check className="size-4 shrink-0" />}
              </div>
            ))}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
