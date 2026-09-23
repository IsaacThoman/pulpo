import { replaceEqualDeep } from '@tanstack/react-query'
import type { PersistedClient } from '@tanstack/react-query-persist-client'

export type StoredQueryClient = PersistedClient & { chatDataKeys?: Record<string, string>; chatResponseKeys?: Record<string, string[]> }

export function chatDataPrefix(cacheKey: string): string { return `${cacheKey}:chat-data:` }

/** Keep query metadata small; immutable transcript bodies live in separate records. */
export function splitQueryCache(client: PersistedClient, cacheKey: string, previous: ReadonlyMap<string, unknown>) {
  const data = new Map<string, unknown>()
  const changed = new Map<string, unknown>()
  const references: Record<string, string> = {}
  const responseReferences: Record<string, string[]> = {}
  const record = (key: string, value: unknown) => {
    data.set(key, value)
    if (!previous.has(key) || previous.get(key) !== value) changed.set(key, value)
  }
  const queries = client.clientState.queries.map((incoming) => {
    // A transient failed refetch must not erase the last successful offline data.
    const query = incoming.state.status === 'error' ? {
      ...incoming,
      state: { ...incoming.state, status: 'success' as const, error: null, fetchFailureCount: 0, fetchFailureReason: null },
    } : incoming
    if (query.queryKey[0] !== 'chat') return query
    const key = `${chatDataPrefix(cacheKey)}${query.queryHash}`
    references[query.queryHash] = key
    const chat = query.state.data as { responses?: Array<{ id: string }> } | undefined
    if (chat && Array.isArray(chat.responses)) {
      const { responses, ...header } = chat
      const keys: string[] = []
      for (const response of responses) {
        const responseKey = `${key}:response:${response.id}`
        keys.push(responseKey)
        record(responseKey, response)
      }
      responseReferences[query.queryHash] = keys
      record(key, replaceEqualDeep(previous.get(key), header))
    } else record(key, query.state.data)
    return { ...query, state: { ...query.state, data: undefined } }
  })
  const envelope: StoredQueryClient = {
    ...client,
    clientState: { ...client.clientState, queries },
    chatDataKeys: references,
    chatResponseKeys: responseReferences,
  }
  return { envelope, data, changed }
}

export function restoreQueryCache(client: StoredQueryClient, data: ReadonlyMap<string, unknown>): PersistedClient {
  const { chatDataKeys, chatResponseKeys, ...envelope } = client
  // Existing installations still have a single, self-contained persisted client.
  if (!chatDataKeys) return envelope
  return {
    ...envelope,
    clientState: {
      ...envelope.clientState,
      queries: envelope.clientState.queries.flatMap((query) => {
        const key = chatDataKeys[query.queryHash]
        if (!key) return [query]
        // Never hydrate a successful detail query with a missing body.
        if (!data.has(key)) return []
        const responseKeys = chatResponseKeys?.[query.queryHash]
        if (responseKeys?.some(responseKey => !data.has(responseKey))) return []
        const body = responseKeys ? { ...data.get(key) as object, responses: responseKeys.map(responseKey => data.get(responseKey)) } : data.get(key)
        return [{ ...query, state: { ...query.state, data: body } }]
      }),
    },
  }
}
