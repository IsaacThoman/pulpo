import { searchConnectInputSchema } from '@pulpo/contracts'

export const SEARCH_CONNECT_PATH = '/connect/search'

export function readSearchConnectInput(search: string) {
  const params = new URLSearchParams(search)
  return searchConnectInputSchema.safeParse({
    codeChallenge: params.get('code_challenge'),
    state: params.get('state'),
  }).data
}

export function searchConnectReturn(path: string | undefined): string | undefined {
  if (!path) return undefined
  const [pathname, query] = path.split('?', 2)
  if (pathname !== SEARCH_CONNECT_PATH || !query) return undefined
  const input = readSearchConnectInput(query)
  if (!input) return undefined
  const params = new URLSearchParams({ code_challenge: input.codeChallenge, state: input.state })
  return `${SEARCH_CONNECT_PATH}?${params}`
}
