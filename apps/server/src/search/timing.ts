import { randomUUID } from 'node:crypto'
import type { FastifyBaseLogger } from 'fastify'
import type { SearchAttemptOutcome, SearchRequestAttempt, SearchRequestOutcome, SearchRequestPhases } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { searchRequests } from '../database/schema.js'

type Phase = keyof SearchRequestPhases

const SERVER_TIMING_PHASES: Array<[Phase, string]> = [
  ['requestMs', 'request'], ['settingsMs', 'settings'], ['reserveMs', 'reserve'], ['releaseMs', 'release'], ['settleMs', 'settle'],
]

const round = (ms: number) => Math.max(0, Math.round(ms))

/** Errors thrown by `AbortSignal.timeout`, as opposed to a cancelled request or a provider failure. */
export function isTimeoutError(error: unknown, signal?: AbortSignal): boolean {
  const reason = signal?.aborted ? signal.reason : error
  return typeof reason === 'object' && reason !== null && (reason as { name?: unknown }).name === 'TimeoutError'
}

/**
 * Times the phases and provider attempts of one Search request. Times are offsets
 * from when the server received the request; `requestMs` covers auth and parsing.
 */
export class SearchTimer {
  readonly attempts: SearchRequestAttempt[] = []
  private readonly started: number
  private readonly totals = new Map<Phase, number>()

  constructor(receivedAt?: Date | null) {
    const before = receivedAt ? Math.max(0, Date.now() - receivedAt.getTime()) : 0
    this.started = performance.now() - before
    if (receivedAt) this.totals.set('requestMs', before)
  }

  elapsed(): number {
    return performance.now() - this.started
  }

  async time<T>(phase: Phase, run: () => Promise<T>): Promise<T> {
    const start = performance.now()
    try {
      return await run()
    } finally {
      this.totals.set(phase, (this.totals.get(phase) ?? 0) + performance.now() - start)
    }
  }

  /** Starts a provider attempt; call the result once with how it ended. */
  attempt(provider: string): (outcome: SearchAttemptOutcome, resultCount?: number) => void {
    const start = performance.now()
    let done = false
    return (outcome, resultCount) => {
      if (done) return
      done = true
      const durationMs = performance.now() - start
      if (!outcome.startsWith('skipped_')) this.totals.set('providerMs', (this.totals.get('providerMs') ?? 0) + durationMs)
      this.attempts.push({
        provider, outcome, startMs: round(start - this.started), durationMs: round(durationMs),
        ...(resultCount !== undefined ? { resultCount } : {}),
      })
    }
  }

  phases(): SearchRequestPhases {
    return Object.fromEntries([...this.totals].map(([phase, ms]) => [phase, round(ms)]))
  }

  /** A `Server-Timing` value so browser devtools show where the time went. */
  serverTiming(totalMs: number): string {
    const phases = this.phases()
    const entries = SERVER_TIMING_PHASES.flatMap(([phase, name]) => phases[phase] !== undefined ? [`${name};dur=${phases[phase]}`] : [])
    for (const attempt of this.attempts) {
      entries.push(`${attempt.provider.replace(/[^a-z0-9_-]/gi, '')};dur=${attempt.durationMs};desc="${attempt.outcome}"`)
    }
    entries.push(`total;dur=${round(totalMs)}`)
    return entries.join(', ')
  }
}

export interface SearchRequestRecord {
  userId: string
  kind: 'query' | 'places'
  category: string
  page?: number
  outcome: SearchRequestOutcome
  provider?: string | null
  resultCount?: number
  durationMs: number
  queryLength: number
  filters: string[]
  timer: SearchTimer
}

/** Writes the timing row in the background; a failure never reaches the searcher. */
export function recordSearchRequest(log: FastifyBaseLogger, record: SearchRequestRecord): void {
  const { timer, ...row } = record
  const attempts = timer.attempts
  void Promise.resolve().then(() => db.insert(searchRequests).values({
    id: randomUUID(), ...row, page: row.page ?? 1, provider: row.provider ?? null, resultCount: row.resultCount ?? 0,
    durationMs: round(row.durationMs), fallback: attempts.length > 1, phases: timer.phases(), attempts,
  })).catch((error: unknown) => {
    log.warn({ err: error, kind: row.kind }, 'Search timing could not be recorded')
  })
}
