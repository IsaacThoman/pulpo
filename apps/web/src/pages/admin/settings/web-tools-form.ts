import type { WebToolProvider, WebToolsSettings } from '@pulpo/contracts'

export type WebToolsForm = Omit<WebToolsSettings, 'kagi' | 'firecrawl'> & {
  kagi: WebToolsSettings['kagi'] & { hasApiKey: boolean }
  firecrawl: WebToolsSettings['firecrawl'] & { hasApiKey: boolean }
}

export function moveWebProvider(value: WebToolProvider[], index: number, offset: -1 | 1): WebToolProvider[] {
  const target = index + offset
  if (target < 0 || target >= value.length) return value
  const next = [...value]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

export function webToolsPatchBody(web: WebToolsForm, kagiApiKey: string, firecrawlApiKey: string) {
  const { hasApiKey: _kagiHasApiKey, ...kagi } = web.kagi
  const { hasApiKey: _firecrawlHasApiKey, ...firecrawl } = web.firecrawl
  return {
    ...web,
    kagi,
    firecrawl,
    kagiApiKey: kagiApiKey || undefined,
    firecrawlApiKey: firecrawlApiKey || undefined,
  }
}
