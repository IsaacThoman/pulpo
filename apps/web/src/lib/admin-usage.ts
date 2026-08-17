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
  | { type: 'tool'; id: string; at: string; turnNumber: number | null; label: string; status: string; durationMs: number | null; costMicros: number; detail: AdminUsageRequestDetail['tools'][number] }
  | { type: 'ocr'; id: string; at: string; turnNumber: null; label: string; status: string; durationMs: number | null; costMicros: null; detail: AdminUsageRequestDetail['ocrAttempts'][number] }

export function adminUsageTimeline(detail: AdminUsageRequestDetail): AdminTimelineItem[] {
  return [
    ...detail.attempts.map((attempt): AdminTimelineItem => ({
      type: 'model', id: attempt.id, at: attempt.startedAt, turnNumber: attempt.turnNumber,
      label: attempt.purpose === 'generation' ? attempt.model.name : `${attempt.purpose} · ${attempt.model.name}`,
      status: attempt.status, durationMs: attempt.durationMs, costMicros: attempt.costMicros, detail: attempt,
    })),
    ...detail.tools.map((tool): AdminTimelineItem => ({
      type: 'tool', id: tool.id, at: tool.startedAt ?? detail.request.createdAt, turnNumber: tool.turnNumber,
      label: tool.name, status: tool.status, durationMs: tool.durationMs, costMicros: tool.billedCostMicros, detail: tool,
    })),
    ...detail.ocrAttempts.map((ocr, index): AdminTimelineItem => ({
      type: 'ocr', id: ocr.id, at: ocr.createdAt, turnNumber: null,
      label: `OCR ${index + 1}${ocr.cached ? ' · cached' : ''}`, status: ocr.status, durationMs: ocr.durationMs, costMicros: null, detail: ocr,
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.type.localeCompare(b.type))
}

export function reconciliationMatches(detail: AdminUsageRequestDetail): boolean {
  return detail.reconciliation.remainderMicros === 0
}
