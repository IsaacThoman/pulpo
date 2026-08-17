import { describe, expect, it } from 'vitest'
import type { AdminUsageRequestDetail } from '@pulpo/contracts'
import { adminTimelineConnectsToNext, adminTimelineItemTitle, adminUsageAttemptTitle, adminUsageQueryParams, adminUsageRoutingSummary, adminUsageTimeline, formatMicros, reconciliationMatches, setAdminUsageFilter } from './admin-usage'

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

  it('places historical untimed tools after chronological events without inventing a timestamp', () => {
    const detail = {
      request: { createdAt: '2026-08-16T12:00:00.000Z' },
      attempts: [{ id: 'turn', startedAt: '2026-08-16T12:00:02.000Z', turnNumber: 1, purpose: 'generation', model: { name: 'Model' }, status: 'completed', durationMs: 10, costMicros: 2, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, retryAttempt: 1 }],
      tools: [
        { id: 'untimed', startedAt: null, turnNumber: null, name: 'legacy_tool', status: 'completed', durationMs: 5, billedCostMicros: 1 },
        { id: 'timed', startedAt: '2026-08-16T12:00:01.000Z', turnNumber: 1, name: 'bash', status: 'completed', durationMs: 5, billedCostMicros: 1 },
      ],
      ocrAttempts: [],
      reconciliation: { remainderMicros: 0 },
    } as unknown as AdminUsageRequestDetail
    const timeline = adminUsageTimeline(detail)
    expect(timeline.map((item) => item.id)).toEqual(['timed', 'turn', 'untimed'])
    expect(timeline[2]?.at).toBeNull()
    expect(adminTimelineItemTitle(timeline[2]!)).toBe('Run-level tool')
  })

  it('ends the timeline connector at the final recorded event', () => {
    const items = [
      { at: '2026-08-16T12:00:00.000Z' },
      { at: '2026-08-16T12:00:01.000Z' },
    ] as ReturnType<typeof adminUsageTimeline>
    expect(adminTimelineConnectsToNext(items, 0)).toBe(true)
    expect(adminTimelineConnectsToNext(items, 1)).toBe(false)
  })

  it('does not connect chronological events to untimed historical activity', () => {
    const items = [
      { at: '2026-08-16T12:00:00.000Z' },
      { at: null },
    ] as ReturnType<typeof adminUsageTimeline>
    expect(adminTimelineConnectsToNext(items, 0)).toBe(false)
  })

  it('summarizes a fallback path without repeating it for later agent turns', () => {
    const detail = {
      request: {
        requestedModel: { id: 'primary', name: 'Primary' },
        actualModel: { id: 'fallback', name: 'Fallback' },
        fallbackUsed: true,
        stickyFallbackUsed: false,
        errorCategory: null,
      },
      attempts: [
        { id: 'primary-failure', purpose: 'generation', model: { id: 'primary', name: 'Primary' }, fallbackFromModelId: null, status: 'failed', retryReason: null, errorCategory: 'provider_http', durationMs: 800, costMicros: 120, startedAt: '2026-08-16T12:00:00.000Z' },
        { id: 'fallback-turn-1', purpose: 'generation', model: { id: 'fallback', name: 'Fallback' }, fallbackFromModelId: 'primary', status: 'completed', retryReason: null, errorCategory: null, durationMs: 1_200, costMicros: 300, startedAt: '2026-08-16T12:00:01.000Z' },
        { id: 'fallback-turn-2', purpose: 'generation', model: { id: 'fallback', name: 'Fallback' }, fallbackFromModelId: 'primary', status: 'completed', retryReason: null, errorCategory: null, durationMs: 900, costMicros: 220, startedAt: '2026-08-16T12:00:03.000Z' },
      ],
    } as unknown as AdminUsageRequestDetail
    const routing = adminUsageRoutingSummary(detail)
    expect(routing.path.map((model) => model.name)).toEqual(['Primary', 'Fallback'])
    expect(routing).toMatchObject({ failedAttemptCount: 1, overheadCostMicros: 120, overheadDurationMs: 800, reason: 'provider_http' })
  })

  it('identifies a sticky fallback that skipped the primary model', () => {
    const detail = {
      request: {
        requestedModel: { id: 'primary', name: 'Primary' },
        actualModel: { id: 'fallback', name: 'Fallback' },
        fallbackUsed: true,
        stickyFallbackUsed: true,
        errorCategory: null,
      },
      attempts: [
        { purpose: 'generation', model: { id: 'fallback', name: 'Fallback' }, fallbackFromModelId: 'primary', status: 'completed', retryReason: null, errorCategory: null, durationMs: 500, costMicros: 200, startedAt: '2026-08-16T12:00:00.000Z' },
      ],
    } as unknown as AdminUsageRequestDetail
    expect(adminUsageRoutingSummary(detail)).toMatchObject({ primarySkipped: true, failedAttemptCount: 0, overheadCostMicros: 0 })
  })

  it('labels retries and ancillary model calls consistently', () => {
    const attempt = { turnNumber: 2, purpose: 'generation', retryAttempt: 2 } as AdminUsageRequestDetail['attempts'][number]
    const ocr = { turnNumber: null, purpose: 'ocr', retryAttempt: 1 } as AdminUsageRequestDetail['attempts'][number]
    expect(adminUsageAttemptTitle(attempt)).toBe('Turn 2 retry 2')
    expect(adminUsageAttemptTitle(ocr)).toBe('OCR model call')
  })

  it('formats micros densely, including negative remainders', () => {
    expect(formatMicros(12_345)).toBe('$0.0123')
    expect(formatMicros(-12_345)).toBe('-$0.0123')
  })
})
