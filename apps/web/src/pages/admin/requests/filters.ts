import type { AdminRequestSort, ClientPlatform } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'

/** URL keys forwarded to the analytics API as request filters. */
export const REQUEST_FILTER_KEYS = [
  'status', 'origin', 'platform', 'model', 'userId', 'apiKeyId',
  'errorCategory', 'retry', 'fallback', 'agent', 'ocr',
] as const

export const REQUEST_STATUSES = ['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete'] as const
export const REQUEST_ORIGINS = ['web', 'api', 'admin_chat'] as const
export const CLIENT_PLATFORMS: ClientPlatform[] = ['web', 'desktop', 'ios', 'android', 'cli', 'api', 'unknown']
export const REQUEST_SORTS: AdminRequestSort[] = ['newest', 'slowest', 'costliest']

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'incomplete'])

export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status)
}

export function parseSort(value: string | null): AdminRequestSort {
  return value === 'slowest' || value === 'costliest' ? value : 'newest'
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'queued': return ui('Queued')
    case 'in_progress': return ui('In progress')
    case 'completed': return ui('Completed')
    case 'failed': return ui('Failed')
    case 'cancelled': return ui('Cancelled')
    case 'incomplete': return ui('Incomplete')
    default: return status
  }
}

export function originLabel(origin: string): string {
  switch (origin) {
    case 'web': return ui('Chat')
    case 'api': return ui('API')
    case 'admin_chat': return ui('Admin chat')
    default: return origin
  }
}

export function platformLabel(platform: string): string {
  switch (platform) {
    case 'web': return ui('Web')
    case 'desktop': return ui('Desktop')
    case 'ios': return ui('iOS')
    case 'android': return ui('Android')
    case 'cli': return ui('CLI')
    case 'api': return ui('API')
    case 'unknown': return ui('Unknown')
    default: return platform
  }
}

export function sortLabel(sort: AdminRequestSort): string {
  switch (sort) {
    case 'newest': return ui('Newest first')
    case 'slowest': return ui('Slowest first')
    case 'costliest': return ui('Costliest first')
  }
}

/** Error categories are server identifiers like `rate_limit`; show them readably. */
export function categoryLabel(category: string | null): string {
  return category ? category.replaceAll('_', ' ') : ui('Uncategorized')
}

export function modelName(modelNames: Record<string, string> | undefined, id: string | null): string {
  if (!id) return '—'
  return modelNames?.[id] ?? id
}
