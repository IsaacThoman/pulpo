import { chatSearchDocument, chatSearchTerms } from '@pulpo/client-core'

const SNIPPET_LENGTH = 180

export function chatSearchSnippet(input: unknown, output: unknown, query: string): string | null {
  return chatSearchTextSnippet(chatSearchDocument(input, output), query)
}

export function chatSearchTextSnippet(value: string, query: string): string | null {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return null
  const normalized = text.normalize('NFKC').toLocaleLowerCase()
  const positions = chatSearchTerms(query)
    .map((term) => normalized.indexOf(term))
    .filter((position) => position >= 0)
  const matchAt = positions.length ? Math.min(...positions) : 0
  const start = Math.max(0, matchAt - Math.floor(SNIPPET_LENGTH / 3))
  const end = Math.min(text.length, start + SNIPPET_LENGTH)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

export function chatSearchTsQuery(query: string): string {
  return chatSearchTerms(query).map((term) => `${term}:*`).join(' & ')
}
