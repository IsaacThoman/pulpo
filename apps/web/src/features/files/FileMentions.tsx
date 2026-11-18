import { useCallback, useEffect, useId, useState, type KeyboardEvent, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FILE_SEARCH_QUERY_MAX_LENGTH, type FileReference, type FileSearchResults } from '@pulpo/contracts'
import {
  activeFileMention,
  applyFileMention,
  fileMentionKey,
  fileMentionRequestLimit,
  fileMentionSuggestions,
} from '@pulpo/client-core/files'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { fileSearchQueryKey, searchFiles } from './api'
import { FileNodeIcon } from './FileNodeIcon'

type Suggestion = FileSearchResults['items'][number]

/** Waits for typing to pause before searching, so each keystroke doesn't send a request. */
const SEARCH_DELAY_MS = 150

function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}

/**
 * Typing `@` in the message box lists matching Files items under the caret's word; choosing one
 * writes its name in place and mentions it, as "Add from Files…" does (see applyFileMention).
 * The list never takes focus: the text box keeps it and drives the list from its keys.
 */
export function useFileMention({ enabled, text, references, anchorRef, onChoose }: {
  /** Whether this message can mention Files items at all. */
  enabled: boolean
  /** The typed text, without the draft's references. */
  text: string
  references: readonly FileReference[]
  /** What the list sits above: the composer, text box included. */
  anchorRef: RefObject<HTMLElement | null>
  /** Puts `next.text` in the box, adds `reference` to the draft, and places the caret. */
  onChoose: (next: { text: string; caret: number }, reference: FileReference) => void
}) {
  const userId = useAuth((state) => state.user?.id)
  const listId = useId()
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)

  const token = enabled && focused && selection ? activeFileMention(text, selection.start, selection.end) : null
  const key = fileMentionKey(token)
  // Escape hides the list for one token; it comes back for the next.
  useEffect(() => { if (dismissed !== null && key !== dismissed) setDismissed(null) }, [dismissed, key])
  const searching = token !== null && key !== dismissed
  const typed = searching ? token.query.slice(0, FILE_SEARCH_QUERY_MAX_LENGTH) : ''
  const query = useDebounced(typed, SEARCH_DELAY_MS)
  const limit = fileMentionRequestLimit(references)
  // Results are kept per query, so a slow answer for an earlier one never replaces a newer one.
  // They leave the cache soon after, so a search per keystroke isn't saved for offline use. The
  // app's client is passed in: nothing else in the composer needs a provider, and its tests have none.
  const results = useQuery({
    queryKey: fileSearchQueryKey(userId, query, limit),
    queryFn: ({ signal }) => searchFiles(query, limit, signal),
    enabled: Boolean(userId && searching && query === typed),
    staleTime: 15_000,
    gcTime: 60_000,
    retry: false,
  }, queryClient)
  // While the next answer is on its way the last list for this word stays up, but never another word's.
  const current = searching && query === typed ? results.data : undefined
  const [last, setLast] = useState<{ key: string; data: FileSearchResults } | null>(null)
  useEffect(() => {
    if (!key) setLast(null)
    else if (current) setLast({ key, data: current })
  }, [key, current])
  const data = current ?? (searching && last?.key === key ? last.data : undefined)
  const suggestions = data ? fileMentionSuggestions(data.items.map((item) => ({ ...item, id: item.node.id })), references) : []
  const open = suggestions.length > 0
  const active = open ? Math.min(highlight, suggestions.length - 1) : -1
  useEffect(() => { setHighlight(0) }, [key, query])

  const track = useCallback((element: HTMLTextAreaElement) => {
    setSelection({ start: element.selectionStart, end: element.selectionEnd })
  }, [])

  const choose = (suggestion: Suggestion) => {
    if (!token) return
    const next = applyFileMention(text, token, suggestion.node.name)
    setSelection({ start: next.caret, end: next.caret })
    onChoose(next, { id: suggestion.node.id, name: suggestion.node.name, folder: suggestion.node.kind === 'folder' })
  }

  /** Handles a key for the list; true when it did, so the composer leaves the key alone. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || event.nativeEvent.isComposing) return false
    const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight((active + step + suggestions.length) % suggestions.length)
      return true
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && plain) {
      event.preventDefault()
      choose(suggestions[active]!)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDismissed(key)
      return true
    }
    return false
  }

  const optionId = (index: number) => `${listId}-option-${index}`
  const inputProps = {
    'aria-autocomplete': 'list' as const,
    'aria-controls': open ? listId : undefined,
    'aria-activedescendant': open ? optionId(active) : undefined,
    onFocus: (event: { currentTarget: HTMLTextAreaElement }) => { setFocused(true); track(event.currentTarget) },
    onBlur: () => setFocused(false),
    onSelect: (event: { currentTarget: HTMLTextAreaElement }) => track(event.currentTarget),
  }

  const list = (
    <Popover open={open}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-80 p-1"
        // The text box keeps focus and handles Escape itself.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        // Clicking in the composer moves the caret, which decides whether the list stays.
        onInteractOutside={(event) => { if (anchorRef.current?.contains(event.target as Node)) event.preventDefault() }}
      >
        <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{query ? ui("Mention from Files") : ui("Recent in Files")}</p>
        <div role="listbox" id={listId} aria-label={ui("Files")}>
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion.node.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              // Pressing a row must not move focus out of the text box.
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => { if (index !== active) setHighlight(index) }}
              onClick={() => choose(suggestion)}
              className={cn(
                'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden',
                index === active && 'bg-accent text-accent-foreground',
              )}
            >
              <FileNodeIcon node={suggestion.node} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{suggestion.node.name}</span>
              <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">{suggestion.parent?.name ?? ui("My files")}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )

  return { open, inputProps, onKeyDown, track, list }
}
