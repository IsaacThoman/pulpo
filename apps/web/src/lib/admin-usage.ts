import type { AdminUsageRequestDetail } from '@pulpo/contracts'

export const ADMIN_USAGE_FILTER_KEYS = [
  'range', 'status', 'origin', 'model', 'userId', 'apiKeyId', 'agent', 'retry', 'fallback', 'ocr', 'errorCategory', 'tool', 'q',
] as const

export function adminUsageQueryParams(params: URLSearchParams): URLSearchParams {
  const output = new URLSearchParams()
  for (const key of ADMIN_USAGE_FILTER_KEYS) {
    const value = params.get(key)
    if (value) output.set(key, value)
  }
  if (!output.has('range')) output.set('range', '24h')
  output.set('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  return output
}

export function setAdminUsageFilter(params: URLSearchParams, key: string, value?: string | null): URLSearchParams {
  const next = new URLSearchParams(params)
  if (!value || (value === 'all' && key !== 'range')) next.delete(key)
  else next.set(key, value)
  next.delete('cursor')
  return next
}

export function formatMicros(micros: number): string {
  const dollars = micros / 1_000_000
  if (dollars === 0) return '$0.0000'
  if (Math.abs(dollars) < 0.0001) return `${dollars < 0 ? '-' : ''}<$0.0001`
  return `${dollars < 0 ? '-' : ''}$${Math.abs(dollars).toFixed(4)}`
}

export type AdminTimelineItem =
  | { type: 'model'; id: string; at: string; turnNumber: number | null; label: string; status: string; durationMs: number | null; costMicros: number; detail: AdminUsageRequestDetail['attempts'][number] }
  | { type: 'tool'; id: string; at: string | null; turnNumber: number | null; label: string; status: string; durationMs: number | null; costMicros: number; detail: AdminUsageRequestDetail['tools'][number] }
  | { type: 'ocr'; id: string; at: string; turnNumber: null; label: string; status: string; durationMs: number | null; costMicros: null; detail: AdminUsageRequestDetail['ocrAttempts'][number] }

export function adminUsageTimeline(detail: AdminUsageRequestDetail): AdminTimelineItem[] {
  return [
    ...detail.attempts.map((attempt): AdminTimelineItem => ({
      type: 'model', id: attempt.id, at: attempt.startedAt, turnNumber: attempt.turnNumber,
      label: attempt.model.name,
      status: attempt.status, durationMs: attempt.durationMs, costMicros: attempt.costMicros, detail: attempt,
    })),
    ...detail.tools.map((tool): AdminTimelineItem => ({
      type: 'tool', id: tool.id, at: tool.startedAt, turnNumber: tool.turnNumber,
      label: tool.name, status: tool.status, durationMs: tool.durationMs, costMicros: tool.billedCostMicros, detail: tool,
    })),
    ...detail.ocrAttempts.map((ocr, index): AdminTimelineItem => ({
      type: 'ocr', id: ocr.id, at: ocr.createdAt, turnNumber: null,
      label: `OCR ${index + 1}${ocr.cached ? ' · cached' : ''}`, status: ocr.status, durationMs: ocr.durationMs, costMicros: null, detail: ocr,
    })),
  ].sort((a, b) => {
    if (a.at === null) return b.at === null ? 0 : 1
    if (b.at === null) return -1
    return Date.parse(a.at) - Date.parse(b.at) || a.type.localeCompare(b.type)
  })
}

export function adminUsageAttemptTitle(attempt: AdminUsageRequestDetail['attempts'][number]): string {
  let title = 'Model call'
  if (attempt.turnNumber) title = `Turn ${attempt.turnNumber}`
  else if (attempt.purpose === 'title') title = 'Title generation'
  else if (attempt.purpose === 'memory') title = 'Memory update'
  else if (attempt.purpose === 'compaction') title = 'Context compaction'
  else if (attempt.purpose === 'user_data') title = 'User data extraction'
  else if (attempt.purpose === 'ocr') title = 'OCR model call'
  return attempt.retryAttempt > 1 ? `${title} retry ${attempt.retryAttempt}` : title
}

export function adminTimelineItemTitle(item: AdminTimelineItem): string {
  if (item.type === 'tool') return item.turnNumber ? `Turn ${item.turnNumber} tool` : 'Run-level tool'
  if (item.type === 'ocr') return 'OCR'
  return adminUsageAttemptTitle(item.detail)
}

export function adminTimelineConnectsToNext(items: AdminTimelineItem[], index: number): boolean {
  const current = items[index]
  const next = items[index + 1]
  return Boolean(current && next && current.at !== null && next.at !== null)
}

export function reconciliationMatches(detail: AdminUsageRequestDetail): boolean {
  return detail.reconciliation.remainderMicros === 0
}
