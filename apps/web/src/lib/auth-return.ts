import { readSearchHandoff, SEARCH_HANDOFF_PATH, searchHandoffPath } from '@pulpo/contracts/search'
import { searchConnectReturn } from './search-connect'

const chatReturnPath = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

export function searchHandoffReturn(pathname: string, hash: string): string | undefined {
  if (pathname !== SEARCH_HANDOFF_PATH) return undefined
  const handoff = readSearchHandoff(hash)
  return handoff && searchHandoffPath(handoff)
}

export function authReturn(path: string | undefined): string | undefined {
  if (!path) return undefined
  const chatId = chatReturnPath.exec(path)?.[1]
  if (chatId) return `/c/${chatId}`
  const hashIndex = path.indexOf('#')
  return searchConnectReturn(path) ?? (hashIndex === -1
    ? undefined
    : searchHandoffReturn(path.slice(0, hashIndex), path.slice(hashIndex)))
}

export function authReturnLoginState(state: unknown): { from: string } | undefined {
  if (typeof state !== 'object' || !state || !('from' in state) || typeof state.from !== 'string') return undefined
  const from = authReturn(state.from)
  return from ? { from } : undefined
}
