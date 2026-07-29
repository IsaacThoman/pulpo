import { useState } from 'react'
import { Copy, Download, MoreHorizontal, Plus, Search, Settings2, Share2, Trash2, Upload } from 'lucide-react'
import { ADMIN_FUNCTIONS, type AdminFunction } from '@/lib/mock-admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const TYPE_STYLE: Record<AdminFunction['type'], string> = {
  pipe: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  filter: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  action: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  event: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
}

export function FunctionsPage() {
  const [fns, setFns] = useState(ADMIN_FUNCTIONS)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const filtered = fns.filter(
    (f) =>
      (typeFilter === 'all' || f.type === typeFilter) &&
      f.name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Functions</h2>
        <Badge variant="secondary">{fns.length}</Badge>
        <div className="flex-1" />
        <Button variant="outline" size="sm">
          <Upload />
          Import
        </Button>
        <Button variant="outline" size="sm">
          <Download />
          Export
        </Button>
        <Button size="sm">
          <Plus />
          New function
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search functions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex rounded-lg border p-0.5">
          {['all', 'pipe', 'filter', 'action', 'event'].map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'cursor-pointer rounded-md px-2 py-1 text-xs capitalize transition-colors',
                typeFilter === t ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((f) => (
          <Card key={f.id} className={cn('shadow-none', !f.enabled && 'opacity-55')}>
            <CardContent className="px-4 py-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        TYPE_STYLE[f.type]
                      )}
                    >
                      {f.type}
                    </span>
                    <span className="truncate text-sm font-medium">{f.name}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    v{f.version} · by {f.author}
                    {f.global && ' · global'}
                  </div>
                </div>
                <Switch
                  checked={f.enabled}
                  onCheckedChange={(v) =>
                    setFns((s) => s.map((x) => (x.id === f.id ? { ...x, enabled: v } : x)))
                  }
                />
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{f.description}</p>
              <div className="mt-3 flex items-center gap-1">
                <Button variant="outline" size="sm">
                  <Settings2 />
                  Valves
                </Button>
                <div className="flex-1" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                      <Share2 />
                      Share to community
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Copy />
                      Clone
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Download />
                      Export
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive">
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Functions execute arbitrary code — only install from sources you trust.
      </p>
    </div>
  )
}
