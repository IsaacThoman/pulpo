import type { ProviderApiFormat } from '@pulpo/contracts'

export const ANTHROPIC_VERSION = '2023-06-01'
const MAX_MODEL_PAGES = 20

/** The `/models` listing request for a provider, authenticated the way its protocol expects. */
export function providerModelsRequest(
  provider: { baseUrl: string; apiFormat: ProviderApiFormat },
  apiKey: string,
  afterId?: string,
): { url: string; headers: Record<string, string> } {
  const base = `${provider.baseUrl.replace(/\/+$/, '')}/models`
  if (provider.apiFormat === 'anthropic_messages') {
    const url = new URL(base)
    url.searchParams.set('limit', '1000')
    if (afterId) url.searchParams.set('after_id', afterId)
    return { url: url.toString(), headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION } }
  }
  return { url: base, headers: { authorization: `Bearer ${apiKey}` } }
}

export class ProviderModelsError extends Error {
  constructor(readonly code: 'upstream_unreachable' | 'upstream_error' | 'upstream_invalid', message: string) {
    super(message)
    this.name = 'ProviderModelsError'
  }
}

/** List every upstream model id, following Anthropic's cursor pagination. */
export async function fetchProviderModelIds(
  provider: { baseUrl: string; apiFormat: ProviderApiFormat; requestTimeoutMs: number },
  apiKey: string,
): Promise<string[]> {
  const ids: string[] = []
  let afterId: string | undefined
  for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
    const request = providerModelsRequest(provider, apiKey, afterId)
    let response: Response
    try {
      response = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(provider.requestTimeoutMs) })
    } catch (cause) {
      throw new ProviderModelsError('upstream_unreachable', cause instanceof Error ? cause.message : 'Failed to reach provider /models')
    }
    if (!response.ok) throw new ProviderModelsError('upstream_error', `Provider /models returned ${response.status}`)
    const payload = await response.json().catch(() => undefined) as { data?: Array<{ id?: unknown }>; has_more?: unknown; last_id?: unknown } | undefined
    if (!Array.isArray(payload?.data)) throw new ProviderModelsError('upstream_invalid', 'Provider /models response missing data array')
    ids.push(...payload.data.map((item) => (typeof item?.id === 'string' ? item.id.trim() : '')).filter(Boolean))
    if (provider.apiFormat !== 'anthropic_messages' || payload.has_more !== true || typeof payload.last_id !== 'string' || payload.last_id === afterId) break
    afterId = payload.last_id
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}
