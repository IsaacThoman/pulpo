import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, LoaderCircle, MessageSquare, Search } from 'lucide-react'
import type { ChatSearchResponse, ChatSearchResult } from '@pulpo/contracts'
import { chatSearchHighlight } from '@pulpo/client-core'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useChat } from '@/stores/chat'
import { getCatalogModel } from '@/stores/catalog'
import { apiRequest } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { ModelIcon } from '@/components/ModelIcon'
import { cn } from '@/lib/utils'

const EMPTY_CHATS = [] as const

function HighlightedText({ text, query }: { text: string; query: string }) {
  return chatSearchHighlight(text, query).map((part, index) => part.match
    ? <mark className="rounded-sm bg-yellow-200/80 text-inherit dark:bg-yellow-700/60" key={index}>{part.text}</mark>
    : <span key={index}>{part.text}</span>)
}

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
  const [remote, setRemote] = useState<ChatSearchResult[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [retry, setRetry] = useState(0)
  const allChats = useChat((value) => value.chats)
  const chats = useMemo(
    () => open ? allChats.filter((chat) => !chat.temporary) : EMPTY_CHATS,
    [allChats, open],
  )
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    setRemote([])
    setState('idle')
  }, [open])

  useEffect(() => {
    onQueryPresenceChange?.(open && query.trim().length > 0)
  }, [onQueryPresenceChange, open, query])

  useEffect(() => {
    const q = query.trim()
    if (!open || !q) {
      setRemote([])
      setState('idle')
      return
    }
    const controller = new AbortController()
    setRemote([])
    setState('loading')
    const timer = window.setTimeout(() => {
      void apiRequest<ChatSearchResponse>(`/api/chats/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((result) => {
          setRemote(result.data)
          setState('success')
        })
        .catch(() => {
          if (!controller.signal.aborted) setState('error')
        })
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query, retry])

  const recent = useMemo<ChatSearchResult[]>(() => [...chats]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 10)
    .map((chat) => ({
      chatId: chat.id,
      title: chat.title,
      modelId: chat.modelId,
      updatedAt: new Date(chat.updatedAt).toISOString(),
      matchedOn: 'title',
      snippet: null,
      score: 0,
    })), [chats])
  const searching = query.trim().length > 0
  const results = searching ? remote : recent

  useEffect(() => {
    setCursor((value) => Math.max(0, Math.min(value, results.length - 1)))
  }, [results.length])

  const go = (index: number) => {
    const result = results[index]
    if (!result) return
    navigate(`/c/${result.chatId}`)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <div className="flex items-center gap-2 border-b px-4">
          {state === 'loading'
            ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Searching" />
            : <Search className="size-4 text-muted-foreground" />}
          <input
            autoFocus
            value={query}
            role="combobox"
            aria-autocomplete="list"
            aria-controls="chat-search-results"
            aria-expanded={open}
            aria-activedescendant={results[cursor] ? `chat-search-result-${results[cursor].chatId}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value)
              setCursor(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setCursor((value) => Math.min(value + 1, results.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setCursor((value) => Math.max(value - 1, 0))
              } else if (event.key === 'Enter') {
                go(cursor)
              }
            }}
            placeholder="Search chats and messages…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
        </div>
        <div id="chat-search-results" role="listbox" aria-label="Chat search results" className="max-h-[360px] overflow-y-auto p-1.5">
          {state === 'error' && searching && (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-sm text-muted-foreground">
              <AlertCircle className="size-5" />
              <span>Couldn’t search conversations.</span>
              <button className="rounded-md border px-3 py-1.5 text-foreground hover:bg-accent" onClick={() => setRetry((value) => value + 1)}>Retry</button>
            </div>
          )}
          {state === 'success' && searching && results.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">No results for “{query.trim()}”</div>
          )}
          {!searching && results.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">No chats yet</div>
          )}
          {results.map((result, index) => (
            <button
              id={`chat-search-result-${result.chatId}`}
              role="option"
              aria-selected={index === cursor}
              key={result.chatId}
              className={cn(
                'flex w-full cursor-pointer items-start gap-3 rounded-md px-3 py-2 text-left text-sm',
                index === cursor ? 'bg-accent' : 'hover:bg-accent/60',
              )}
              onMouseEnter={() => setCursor(index)}
              onClick={() => go(index)}
            >
              <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="flex-1 truncate font-medium"><HighlightedText text={result.title} query={searching ? query : ''} /></span>
                  {searching && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{result.matchedOn}</span>}
                </span>
                {result.snippet && <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground"><HighlightedText text={result.snippet} query={query} /></span>}
              </span>
              <ModelIcon model={getCatalogModel(result.modelId)} className="mt-0.5 size-4 rounded-[2px]" />
              <span className="mt-0.5 text-xs text-muted-foreground">{timeAgo(Date.parse(result.updatedAt))}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
