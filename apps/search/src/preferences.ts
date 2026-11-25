import { defaultSearchAccountPreferences, normalizeSearchBangTrigger, searchRegions, type SearchAccountPreferences, type SearchDomainRule } from '@pulpo/contracts/search'
import type { Provider, SearchConfig } from './api'
import { validateCustomBang, type CustomBang } from './bangs'
import type { SearchLocation } from './navigation'

export type Theme = 'pulpo' | 'system' | 'light' | 'dark'
export type DomainRule = SearchDomainRule

export interface Preferences extends SearchAccountPreferences {
  theme: Theme
  rememberRecentQueries: boolean
}

export const preferencesStorageKey = 'pulpo-search-settings-v1'
const defaults: Preferences = {
  ...defaultSearchAccountPreferences,
  theme: 'pulpo',
  rememberRecentQueries: false,
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

export function accountPreferences({
  defaultProvider, fallbackProvider, limit, newTab, keyboardShortcuts,
  localPlaces, defaultRegion, safeSearch, domains, bangs,
}: Preferences): SearchAccountPreferences {
  return { defaultProvider, fallbackProvider, limit, newTab, keyboardShortcuts, localPlaces, defaultRegion, safeSearch, domains, bangs }
}

export function readAccountPreferences(saved: Record<string, unknown>): SearchAccountPreferences {
  const domains = saved.domains && typeof saved.domains === 'object' && !Array.isArray(saved.domains)
    ? Object.entries(saved.domains).filter((entry): entry is [string, DomainRule] => entry[0].length > 0 && entry[0].length <= 253
      && (entry[1] === 'pin' || entry[1] === 'hide')).slice(0, 100) : []
  const bangs = Array.isArray(saved.bangs) ? saved.bangs.filter(isCustomBang).slice(0, 30).map(bang => ({
    trigger: normalizeSearchBangTrigger(bang.trigger), name: bang.name.trim(), url: bang.url.trim(),
  })) : []
  return {
    defaultProvider: isProvider(saved.defaultProvider) ? saved.defaultProvider : '',
    fallbackProvider: isProvider(saved.fallbackProvider) || saved.fallbackProvider === 'none' ? saved.fallbackProvider : '',
    limit: saved.limit === 10 || saved.limit === 20 ? saved.limit : 40,
    newTab: saved.newTab === true,
    keyboardShortcuts: saved.keyboardShortcuts !== false,
    localPlaces: saved.localPlaces !== false,
    defaultRegion: searchRegions.find(([value]) => value === saved.defaultRegion)?.[0] ?? '',
    safeSearch: saved.safeSearch !== false,
    domains: Object.fromEntries(domains),
    bangs,
  }
}

export function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(window.localStorage.getItem(preferencesStorageKey) ?? 'null')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults
    return {
      ...readAccountPreferences(saved),
      theme: saved.theme === 'light' || saved.theme === 'dark' || (saved.theme === 'system' && saved.appearanceVersion === 1) ? saved.theme : 'pulpo',
      rememberRecentQueries: saved.rememberRecentQueries === true,
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

export function searchRegion(input: Pick<SearchLocation, 'region' | 'regionOverride'>, defaultRegion: Preferences['defaultRegion']): string {
  return input.region || (input.regionOverride ? '' : defaultRegion)
}

export function domainRule(host: string, rules: Preferences['domains']): DomainRule | undefined {
  return Object.hasOwn(rules, host) ? rules[host] : undefined
}
