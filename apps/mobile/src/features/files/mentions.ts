import { FILE_SEARCH_QUERY_MAX_LENGTH, type FileReference, type FileSearchResults } from '@pulpo/contracts'
import { activeFileMention, fileMentionKey, fileMentionRequestLimit, fileMentionSuggestions, type FileMentionToken } from '@pulpo/client-core/files'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { searchFiles } from './api'
import { filesQueryKeys } from './queries'

export type FileMentionSuggestion = FileSearchResults['items'][number]

/** Waits for typing to pause before searching, so each keystroke doesn't send a request. */
export const FILE_MENTION_SEARCH_DELAY_MS = 150

function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}

/**
 * Files items to suggest for the `@` word at the caret (see activeFileMention), searched by name
 * once typing pauses. Results are kept per query, so a slow answer for an earlier one never
 * replaces a newer one; while the next is on its way the last list for the same word stays up.
 */
export function useFileMentionSuggestions({ namespace, enabled, text, selection, references }: {
  namespace: string
  /** Files can be mentioned here and the message field has focus. */
  enabled: boolean
  /** The field's text, without the draft's references. */
  text: string
  selection: { start: number; end: number }
  references: readonly FileReference[]
}): { token: FileMentionToken | null; query: string; suggestions: FileMentionSuggestion[] } {
  const token = enabled ? activeFileMention(text, selection.start, selection.end) : null
  const key = fileMentionKey(token)
  const typed = token ? token.query.slice(0, FILE_SEARCH_QUERY_MAX_LENGTH) : ''
  const query = useDebounced(typed, FILE_MENTION_SEARCH_DELAY_MS)
  const limit = fileMentionRequestLimit(references)
  const results = useQuery({
    queryKey: filesQueryKeys.search(namespace, query, limit),
    queryFn: ({ signal }) => searchFiles(query, limit, signal),
    enabled: Boolean(namespace && token && query === typed),
    staleTime: 15_000,
    // A search per keystroke isn't worth keeping around.
    gcTime: 60_000,
    retry: false,
  })
  const current = token && query === typed ? results.data : undefined
  const [last, setLast] = useState<{ key: string; data: FileSearchResults } | null>(null)
  useEffect(() => {
    if (!key) setLast(null)
    else if (current) setLast({ key, data: current })
  }, [key, current])
  const data = current ?? (token && last?.key === key ? last.data : undefined)
  return {
    token,
    query,
    suggestions: data ? fileMentionSuggestions(data.items.map((item) => ({ ...item, id: item.node.id })), references) : [],
  }
}
