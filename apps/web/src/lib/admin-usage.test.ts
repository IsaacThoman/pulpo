import { describe, expect, it } from 'vitest'
import type { AdminUsageRequestDetail } from '@pulpo/contracts'
import { adminTimelineItemTitle, adminUsageQueryParams, adminUsageTimeline, formatMicros, reconciliationMatches, setAdminUsageFilter } from './admin-usage'

describe('admin usage dashboard helpers', () => {
  it('serializes only supported URL filters and adds range and time zone', () => {
    const source = new URLSearchParams('status=failed&tool=web_search&unknown=nope')
    const result = adminUsageQueryParams(source)
    expect(result.get('range')).toBe('24h')
    expect(result.get('status')).toBe('failed')
    expect(result.get('tool')).toBe('web_search')
    expect(result.has('timeZone')).toBe(true)
    expect(result.has('unknown')).toBe(false)
  })

  it('sets and clears filters without mutating the source params', () => {
    const source = new URLSearchParams('range=7d&status=failed')
    expect(setAdminUsageFilter(source, 'status', null).toString()).toBe('range=7d')
    expect(source.get('status')).toBe('failed')
    expect(setAdminUsageFilter(source, 'range', 'all').get('range')).toBe('all')
  })

  it('sorts model, tool, and OCR activity chronologically and preserves historical run-level tools', () => {
    const detail = {
      request: { createdAt: '2026-08-16T12:00:00.000Z' },
      attempts: [{ id: 'a', startedAt: '2026-08-16T12:00:02.000Z', turnNumber: 1, purpose: 'generation', model: { name: 'Model' }, status: 'completed', durationMs: 10, costMicros: 2, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, retryAttempt: 1 }],
      tools: [{ id: 't', startedAt: '2026-08-16T12:00:01.000Z', turnNumber: null, name: 'web_search', status: 'completed', durationMs: 5, billedCostMicros: 1 }],
      ocrAttempts: [{ id: 'o', createdAt: '2026-08-16T12:00:00.500Z', cached: false, status: 'completed', durationMs: 4 }],
      reconciliation: { remainderMicros: 0 },
    } as unknown as AdminUsageRequestDetail
    const timeline = adminUsageTimeline(detail)
    expect(timeline.map((item) => item.type)).toEqual(['ocr', 'tool', 'model'])
    expect(timeline[1]?.turnNumber).toBeNull()
    expect(reconciliationMatches(detail)).toBe(true)
  })

  it('keeps post-response model work in timestamp order and labels its purpose explicitly', () => {
    const detail = {
      request: { createdAt: '2026-08-16T12:00:00.000Z' },
      attempts: [
        { id: 'turn-2', startedAt: '2026-08-16T12:00:02.000Z', turnNumber: 2, purpose: 'generation', model: { name: 'Model' }, status: 'completed', durationMs: 10, costMicros: 2, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, retryAttempt: 1 },
        { id: 'title', startedAt: '2026-08-16T12:00:03.000Z', turnNumber: null, purpose: 'title', model: { name: 'Model' }, status: 'completed', durationMs: 10, costMicros: 2, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, retryAttempt: 1 },
        { id: 'turn-1', startedAt: '2026-08-16T12:00:00.000Z', turnNumber: 1, purpose: 'generation', model: { name: 'Model' }, status: 'completed', durationMs: 10, costMicros: 2, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, retryAttempt: 1 },
      ],
      tools: [{ id: 'tool', startedAt: '2026-08-16T12:00:01.000Z', turnNumber: 1, name: 'bash', status: 'completed', durationMs: 5, billedCostMicros: 1 }],
      ocrAttempts: [],
      reconciliation: { remainderMicros: 0 },
    } as unknown as AdminUsageRequestDetail
    const timeline = adminUsageTimeline(detail)
    expect(timeline.map((item) => item.id)).toEqual(['turn-1', 'tool', 'turn-2', 'title'])
    expect(adminTimelineItemTitle(timeline[3]!)).toBe('Title generation')
  })

  it('formats micros densely, including negative remainders', () => {
    expect(formatMicros(12_345)).toBe('$0.0123')
    expect(formatMicros(-12_345)).toBe('-$0.0123')
  })
})
