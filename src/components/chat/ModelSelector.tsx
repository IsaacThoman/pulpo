import { useMemo, useState } from 'react'
import { Check, ChevronDown, Eye, Search, Wrench, Zap, Brain, Code2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MODELS } from '@/lib/mock'
import { formatNumber } from '@/lib/format'
import { ModelIcon } from '@/components/ModelIcon'
import { cn } from '@/lib/utils'
import type { Model } from '@/lib/types'

const TAG_ICON: Record<string, React.ReactNode> = {
  vision: <Eye className="size-3" />,
  tools: <Wrench className="size-3" />,
  fast: <Zap className="size-3" />,
  reasoning: <Brain className="size-3" />,
  code: <Code2 className="size-3" />,
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
  const selected = MODELS.find((m) => m.id === value) ?? MODELS[0]

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return MODELS.filter(
      (m) => m.enabled && (m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q))
    )
  }, [query])

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-accent">
          <ModelIcon model={selected} className="size-5 rounded-[3px]" />
          <span>{selected.name}</span>
          <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[340px] p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models…"
            className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {filtered.map((m: Model) => (
            <button
              key={m.id}
              className="flex w-full cursor-pointer items-start gap-3 rounded-md px-2.5 py-2 text-left hover:bg-accent"
              onClick={() => {
                onChange(m.id)
                setOpen(false)
              }}
            >
              <ModelIcon model={m} className="mt-0.5 size-6 rounded-[3px]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{m.name}</span>
                  <span className="text-xs text-muted-foreground">{m.provider}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {m.description}
                </span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{formatNumber(m.contextWindow)} ctx</span>
                  {m.tags.map((t) => (
                    <span key={t} className="flex items-center gap-0.5 rounded bg-muted px-1 py-0.5">
                      {TAG_ICON[t]}
                      {t}
                    </span>
                  ))}
                </span>
              </span>
              {m.id === value && <Check className="mt-1 size-4 shrink-0" />}
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
