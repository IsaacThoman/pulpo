import type { SearchAttemptOutcome, SearchRequestOutcome, SearchRequestPhases } from '@pulpo/contracts'
import { VIZ_CATEGORICAL, VIZ_OTHER, VIZ_STATUS } from '@/features/admin-analytics/palette'
import { ui } from '@/i18n/ui'

export const SEARCH_PROVIDERS = ['kagi', 'firecrawl', 'brave'] as const
export const SEARCH_CATEGORIES = ['web', 'news', 'images', 'videos', 'podcasts', 'places'] as const
export const SEARCH_OUTCOMES: SearchRequestOutcome[] = ['success', 'empty', 'error', 'cancelled', 'budget', 'unsupported', 'unavailable', 'filtered']
export const SEARCH_FILTER_KEYS = ['kind', 'provider', 'category', 'outcome'] as const

export type PhaseKey = keyof SearchRequestPhases | 'otherMs'
/** In request order, so stacked bars read left to right as the request ran. */
export const PHASE_KEYS: PhaseKey[] = ['requestMs', 'settingsMs', 'reserveMs', 'providerMs', 'settleMs', 'releaseMs', 'otherMs']

/** Provider names are brands and stay untranslated. */
export function providerLabel(provider: string | null | undefined): string {
  switch (provider) {
    case 'kagi': return 'Kagi'
    case 'firecrawl': return 'Firecrawl'
    case 'brave': return 'Brave'
    default: return provider ?? '—'
  }
}

/** Fixed slots so a provider keeps its color across charts and filters. */
export function providerColor(provider: string): string {
  const index = (SEARCH_PROVIDERS as readonly string[]).indexOf(provider)
  return index >= 0 ? VIZ_CATEGORICAL[index]! : VIZ_OTHER
}

export function categoryLabel(category: string): string {
  switch (category) {
    case 'web': return ui('Web')
    case 'news': return ui('News')
    case 'images': return ui('Images')
    case 'videos': return ui('Videos')
    case 'podcasts': return ui('Podcasts')
    case 'places': return ui('Places')
    default: return category
  }
}

export function outcomeLabel(outcome: SearchRequestOutcome | SearchAttemptOutcome | string): string {
  switch (outcome) {
    case 'success': return ui('Success')
    case 'empty': return ui('No results')
    case 'error': return ui('Error')
    case 'timeout': return ui('Timed out')
    case 'cancelled': return ui('Cancelled')
    case 'budget': return ui('Out of credits')
    case 'skipped_budget': return ui('Skipped: no credits')
    case 'skipped_unhealthy': return ui('Skipped: failing')
    case 'unsupported': return ui('Unsupported')
    case 'unavailable': return ui('No provider')
    case 'filtered': return ui('Filtered out')
    default: return outcome
  }
}

export function failedAttempt(outcome: string): boolean {
  return outcome === 'error' || outcome === 'timeout'
}

export function outcomeColor(outcome: string): string {
  switch (outcome) {
    case 'success': return VIZ_STATUS.completed
    case 'error': case 'timeout': case 'unavailable': return VIZ_STATUS.failed
    case 'empty': case 'budget': case 'skipped_budget': case 'skipped_unhealthy': return VIZ_STATUS.incomplete
    default: return VIZ_STATUS.cancelled
  }
}

export function phaseLabel(phase: PhaseKey): string {
  switch (phase) {
    case 'requestMs': return ui('Auth and parsing')
    case 'settingsMs': return ui('Settings lookup')
    case 'reserveMs': return ui('Credit hold')
    case 'providerMs': return ui('Provider calls')
    case 'settleMs': return ui('Billing')
    case 'releaseMs': return ui('Hold release')
    case 'otherMs': return ui('Other server work')
  }
}

export function phaseColor(phase: PhaseKey): string {
  switch (phase) {
    case 'providerMs': return VIZ_CATEGORICAL[0]
    case 'requestMs': return VIZ_CATEGORICAL[4]
    case 'settingsMs': return VIZ_CATEGORICAL[5]
    case 'reserveMs': return VIZ_CATEGORICAL[6]
    case 'settleMs': return VIZ_CATEGORICAL[7]
    case 'releaseMs': return VIZ_CATEGORICAL[3]
    case 'otherMs': return VIZ_OTHER
  }
}

export function filterLabel(filter: string): string {
  switch (filter) {
    case 'scope': return ui('Focus')
    case 'sites': return ui('Site operators')
    case 'region': return ui('Region')
    case 'date': return ui('Date')
    case 'date_range': return ui('Date range')
    case 'safe_search_off': return ui('SafeSearch off')
    case 'providers': return ui('Chosen provider')
    case 'expanded_images': return ui('Expanded gallery')
    case 'location': return ui('Location')
    case 'open_now': return ui('Open now')
    default: return filter
  }
}
