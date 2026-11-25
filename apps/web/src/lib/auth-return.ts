import { readSearchHandoff, SEARCH_HANDOFF_PATH, searchHandoffPath } from '@pulpo/contracts/search'
import { searchConnectReturn } from './search-connect'

export function searchHandoffReturn(pathname: string, hash: string): string | undefined {
  if (pathname !== SEARCH_HANDOFF_PATH) return undefined
  const handoff = readSearchHandoff(hash)
  return handoff && searchHandoffPath(handoff)
}

export function authReturn(path: string | undefined): string | undefined {
  if (!path) return undefined
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
