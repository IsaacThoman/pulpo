import type { Provider, SearchConfig } from './api'
import { validateCustomBang, type CustomBang } from './bangs'
import type { SearchLocation } from './navigation'

export type Theme = 'pulpo' | 'system' | 'light' | 'dark'
export type DomainRule = 'pin' | 'hide'

export interface Preferences {
  theme: Theme
  defaultProvider: Provider | ''
  fallbackProvider: Provider | 'none' | ''
  limit: 10 | 20
  newTab: boolean
  keyboardShortcuts: boolean
  rememberRecentQueries: boolean
  localPlaces: boolean
  domains: Record<string, DomainRule>
  bangs: CustomBang[]
}

export const preferencesStorageKey = 'pulpo-search-settings-v1'
const defaults: Preferences = {
  theme: 'pulpo',
  defaultProvider: '',
  fallbackProvider: '',
  limit: 10,
  newTab: false,
  keyboardShortcuts: true,
  rememberRecentQueries: false,
  localPlaces: true,
  domains: {},
  bangs: [],
}

function isProvider(value: unknown): value is Provider {
  return value === 'kagi' || value === 'firecrawl'
}

function isCustomBang(value: unknown): value is CustomBang {
  return Boolean(
    value && typeof value === 'object'
    && 'trigger' in value && typeof value.trigger === 'string'
    && 'name' in value && typeof value.name === 'string'
    && 'url' in value && typeof value.url === 'string'
    && validateCustomBang({ trigger: value.trigger, name: value.name, url: value.url }) === null,
  )
}

export function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(window.localStorage.getItem(preferencesStorageKey) ?? 'null')
    if (!saved || typeof saved !== 'object') return defaults
    const domains = Object.entries(saved.domains ?? {})
      .filter((entry): entry is [string, DomainRule] => entry[1] === 'pin' || entry[1] === 'hide')
      .slice(0, 100)
    return {
      theme: saved.theme === 'light' || saved.theme === 'dark' || (saved.theme === 'system' && saved.appearanceVersion === 1) ? saved.theme : 'pulpo',
      defaultProvider: isProvider(saved.defaultProvider) ? saved.defaultProvider : '',
      fallbackProvider: isProvider(saved.fallbackProvider) || saved.fallbackProvider === 'none' ? saved.fallbackProvider : '',
      limit: saved.limit === 20 ? 20 : 10,
      newTab: saved.newTab === true,
      keyboardShortcuts: saved.keyboardShortcuts !== false,
      rememberRecentQueries: saved.rememberRecentQueries === true,
      localPlaces: saved.localPlaces !== false,
      domains: Object.fromEntries(domains),
      bangs: Array.isArray(saved.bangs) ? saved.bangs.filter(isCustomBang).slice(0, 30) : [],
    }
  } catch {
    return defaults
  }
}

export function savePreferences(prefs: Preferences) {
  try {
    window.localStorage.setItem(preferencesStorageKey, JSON.stringify({ ...prefs, appearanceVersion: 1 }))
  } catch {
    // Preferences can still be used for the current page when storage is unavailable.
  }
}

export function providerOrder(prefs: Preferences, config: SearchConfig): Provider[] {
  const available = config.providers.map(provider => provider.id)
  const order = config.defaultOrder.filter(provider => available.includes(provider))
  const primary = available.find(provider => provider === prefs.defaultProvider) ?? order[0]
  if (!primary) return []
  if (prefs.fallbackProvider === 'none') return [primary]
  const fallback = available.find(provider => provider === prefs.fallbackProvider && provider !== primary)
    ?? order.find(provider => provider !== primary)
  return fallback ? [primary, fallback] : [primary]
}

export function compatibleProviders(config: SearchConfig, order: Provider[], input: SearchLocation) {
  return config.providers.filter(provider => order.includes(provider.id)
    && provider.categories.includes(input.category)
    && (provider.maxPage ?? 1) >= (input.page ?? 1)
    && (!input.date || provider.dates.includes(input.date))
    && (!input.dateRange || provider.customDateRanges?.includes(input.category))
    && (!input.region || provider.region))
}

export function domainRule(host: string, rules: Preferences['domains']): DomainRule | undefined {
  return Object.hasOwn(rules, host) ? rules[host] : undefined
}
