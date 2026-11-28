/** Consecutive failures before a provider is skipped. */
const FAILURE_LIMIT = 3
const SKIP_MS = 60_000

/**
 * A per-process circuit breaker for Search providers. After three failures in a
 * row a provider is skipped for a minute while another can answer. Failures are
 * not reset when the minute ends, so one more failure skips it again; a success
 * clears them.
 */
export function createProviderHealth(now = Date.now) {
  const state = new Map<string, { failures: number; skipUntil: number }>()
  return {
    unhealthy(provider: string): boolean {
      return (state.get(provider)?.skipUntil ?? 0) > now()
    },
    succeeded(provider: string): void {
      state.delete(provider)
    },
    failed(provider: string): void {
      const current = state.get(provider) ?? { failures: 0, skipUntil: 0 }
      const failures = current.failures + 1
      state.set(provider, { failures, skipUntil: failures >= FAILURE_LIMIT ? now() + SKIP_MS : current.skipUntil })
    },
  }
}

export type ProviderHealth = ReturnType<typeof createProviderHealth>
