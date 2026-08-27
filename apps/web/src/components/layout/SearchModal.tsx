import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Search } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useChat } from '@/stores/chat'
import { getCatalogModel } from '@/stores/catalog'
import { apiRequest } from '@/lib/api'
import type { ServerChat } from '@/stores/chat'
import { timeAgo } from '@/lib/format'
import { ModelIcon } from '@/components/ModelIcon'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

const EMPTY_CHATS = [] as const
const MAX_QUERY_LENGTH = 200

export function SearchModal({
  open,
  onClose,
  onQueryPresenceChange,
}: {
  open: boolean
  onClose: () => void
  onQueryPresenceChange?: (hasQuery: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const allChats = useChat((state) => state.chats)
  const chats = useMemo(
    () => open ? allChats.filter((chat) => !chat.temporary) : EMPTY_CHATS,
    [allChats, open],
  )
  const navigate = useNavigate()
  const [remote, setRemote] = useState<ServerChat[]>([])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  useEffect(() => {
    onQueryPresenceChange?.(open && query.trim().length > 0)
  }, [onQueryPresenceChange, open, query])

  useEffect(() => {
    const q = query.trim()
    if (!open || !q) { setRemote([]); return }
    setRemote([])
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void apiRequest<{ data: ServerChat[] }>(`/api/chats/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted) setRemote(Array.isArray(result.data) ? result.data : [])
        }).catch(() => undefined)
    }, 180)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [open, query])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return sorted.slice(0, 10)
    const local = sorted.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    )
    const localIds = new Set(local.map((chat) => chat.id))
    return [...local, ...remote.filter((chat) => !localIds.has(chat.id)).map((chat) => ({
      ...chat,
      messages: [],
      createdAt: Date.parse(chat.createdAt),
      updatedAt: Date.parse(chat.updatedAt),
      tags: [],
      temporary: false,
      expiresAt: null,
      expired: false,
    }))]
  }, [chats, query, remote])

  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(0, results.length - 1)))
  }, [results.length])

  const go = (idx: number) => {
    const c = results[idx]
    if (!c) return
    navigate(`/c/${c.id}`)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value.slice(0, MAX_QUERY_LENGTH))
              setCursor(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (e.key === 'Enter') {
                go(cursor)
              }
            }}
            placeholder={ui("Search chats and messages…")}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{ui("esc")}</kbd>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">{ui("No results")}</div>
          )}
          {results.map((c, i) => (
            <button
              key={c.id}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left text-sm',
                i === cursor ? 'bg-accent' : 'hover:bg-accent/60'
              )}
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(i)}
            >
              <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{c.title}</span>
              <ModelIcon model={getCatalogModel(c.modelId)} className="size-4 rounded-[2px]" />
              <span className="text-xs text-muted-foreground">{timeAgo(c.updatedAt)}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
