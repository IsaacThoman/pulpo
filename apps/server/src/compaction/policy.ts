/** Codex compacts at 90% of the context window and treats 95% as full. */
export const AUTO_COMPACT_WINDOW_PERCENT = 90
export const HARD_CONTEXT_WINDOW_PERCENT = 95
export const COMPACTION_MIN_THRESHOLD_TOKENS = 2_000
export const DEFAULT_RETAINED_USER_TOKENS = 20_000
export const MAX_RETAINED_USER_TOKENS = 100_000
export const SUMMARY_MAX_OUTPUT_TOKENS = 8_192

const percentOf = (contextWindow: number, percent: number) => Math.floor(contextWindow * percent / 100)

export function autoCompactLimit(thresholdTokens: number, contextWindow: number): number {
  return Math.max(1, Math.min(thresholdTokens, percentOf(contextWindow, AUTO_COMPACT_WINDOW_PERCENT)))
}

/** Above this a request is treated as a context overflow before it is sent. */
export function hardContextLimit(contextWindow: number): number {
  return Math.max(1, percentOf(contextWindow, HARD_CONTEXT_WINDOW_PERCENT))
}

/** Highest admin threshold that still takes effect; larger values are clamped by autoCompactLimit. */
export function maximumCompactionThreshold(contextWindow: number): number {
  return Math.max(COMPACTION_MIN_THRESHOLD_TOKENS, percentOf(contextWindow, AUTO_COMPACT_WINDOW_PERCENT))
}

/** Output cap of a summary request; the summarizer input trim reserves the same amount. */
export function summaryMaxOutputTokens(modelMaxOutputTokens: number): number {
  return Math.min(SUMMARY_MAX_OUTPUT_TOKENS, modelMaxOutputTokens)
}

/** Keep small-window models well under the limit after compaction. */
export function effectiveRetainedUserTokens(setting: number, autoLimit: number): number {
  return Math.max(0, Math.min(setting, Math.floor(autoLimit / 4)))
}

export function shouldAutoCompact(options: { enabled: boolean; tokens: number; limit: number }): boolean {
  return options.enabled && options.tokens >= options.limit
}
