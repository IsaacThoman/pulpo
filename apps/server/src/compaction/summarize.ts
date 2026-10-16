/** Thrown by a summarizer invocation when the provider reports a context overflow. */
export class CompactionOverflowError extends Error {
  constructor(message = 'Context compaction request exceeded the model context window', options?: ErrorOptions) {
    super(message, options)
    this.name = 'CompactionOverflowError'
  }
}

/** Messages must keep the word "compaction": fallback classification depends on it. */
export class CompactionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CompactionError'
  }
}

export const DEFAULT_MAX_OVERFLOW_DROPS = 32
/** Drops between event-loop yields while trimming a long history. */
export const TRIM_YIELD_INTERVAL = 32

const overflowMessage = 'Context compaction failed: the conversation does not fit in the model context window'

/**
 * Drop oldest units until the history fits the limit. Best effort: when nothing
 * more can be dropped the most-trimmed history comes back with `fits: false`.
 */
export async function trimHistoryToTokenLimit<T>(options: {
  history: T[]
  tokens: (history: T[]) => number
  limit: number
  dropOldest: (history: T[]) => T[] | undefined
}): Promise<{ history: T[]; dropped: number; fits: boolean }> {
  let history = options.history
  let dropped = 0
  while (options.tokens(history) > options.limit) {
    const next = options.dropOldest(history)
    // A drop that removes nothing would loop forever.
    if (!next || next.length >= history.length) return { history, dropped, fits: false }
    history = next
    dropped += 1
    // Each drop is linear in the history, so long trims must not stall other requests.
    if (dropped % TRIM_YIELD_INTERVAL === 0) await new Promise((resolve) => setImmediate(resolve))
  }
  return { history, dropped, fits: true }
}

/** Codex compaction retry loop: on a context overflow drop the oldest unit and try again. */
export async function summarizeWithOverflowRetry<T>(options: {
  history: T[]
  dropOldest: (history: T[]) => T[] | undefined
  invoke: (history: T[]) => Promise<string>
  maxDrops?: number
}): Promise<{ summary: string; dropped: number }> {
  const maxDrops = options.maxDrops ?? DEFAULT_MAX_OVERFLOW_DROPS
  let history = options.history
  let dropped = 0
  for (;;) {
    let summary: string
    try {
      summary = await options.invoke(history)
    } catch (error) {
      if (!(error instanceof CompactionOverflowError)) throw error
      const next = dropped < maxDrops ? options.dropOldest(history) : undefined
      if (!next || next.length >= history.length) throw new CompactionError(overflowMessage, { cause: error })
      history = next
      dropped += 1
      continue
    }
    if (!summary.trim()) throw new CompactionError('Compaction produced an empty summary')
    return { summary: summary.trim(), dropped }
  }
}
