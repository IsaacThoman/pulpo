import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ui, uit } from '@/i18n/ui'

export function UpstreamModelField({
  providerConnectionId,
  value,
  onChange,
}: {
  providerConnectionId: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    if (!providerConnectionId) {
      setOptions([])
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void apiRequest<{ data: string[] }>(`/api/admin/providers/${providerConnectionId}/models`)
      .then((result) => {
        if (!cancelled) setOptions(result.data)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load models')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [providerConnectionId])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((modelId) => modelId.toLowerCase().includes(needle))
  }, [options, query])

  const refresh = async () => {
    if (!providerConnectionId || refreshing) return
    setRefreshing(true)
    setError(null)
    try {
      const result = await apiRequest<{ data: string[] }>(`/api/admin/providers/${providerConnectionId}/models/refresh`, {
        method: 'POST',
      })
      setOptions(result.data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to refresh models')
    } finally {
      setRefreshing(false)
    }
  }

  const select = (modelId: string) => {
    onChange(modelId)
    setQuery(modelId)
    setOpen(false)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen} modal={false}>
          <PopoverAnchor asChild>
            <div className="relative min-w-0 flex-1">
              <Input
                ref={inputRef}
                className="pr-8 font-mono text-xs"
                value={query}
                disabled={!providerConnectionId}
                placeholder={providerConnectionId ? ui("Select or type model name") : ui("Select a provider first")}
                onChange={(event) => {
                  setQuery(event.target.value)
                  onChange(event.target.value)
                  if (!open) setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setOpen(false)
                  if (event.key === 'ArrowDown') setOpen(true)
                  if (event.key === 'Enter' && filtered.length === 1) {
                    event.preventDefault()
                    select(filtered[0]!)
                  }
                }}
              />
              <button
                type="button"
                tabIndex={-1}
                className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                disabled={!providerConnectionId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOpen((current) => !current)}
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
          </PopoverAnchor>
          <PopoverContent
            className="w-[var(--radix-popper-anchor-width)] p-0"
            align="start"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <div className="border-b px-2 py-1.5 text-[11px] text-muted-foreground">
              {loading ? ui("Loading…") : options.length ? uit`${filtered.length} of ${options.length} models` : ui("No cached models — refresh to load")}
            </div>
            <ScrollArea className="h-52">
              <div className="p-1">
                {filtered.map((modelId) => {
                  const selected = modelId === value
                  return (
                    <button
                      key={modelId}
                      type="button"
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-xs hover:bg-accent',
                        selected && 'bg-accent',
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => select(modelId)}
                    >
                      <Check className={cn('size-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate">{modelId}</span>
                    </button>
                  )
                })}
                {!loading && !filtered.length && (
                  <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {options.length ? ui("No matches") : ui("Refresh to fetch upstream models")}
                  </div>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          size="icon"
          variant="outline"
          title={ui("Refresh upstream models")}
          disabled={!providerConnectionId || refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
