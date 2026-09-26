import type { CostLimitItem } from '@pulpo/contracts'
import { redis } from '../redis.js'

/** One item per limit reached, so every pause and continuation stays in the response. */
export function costLimitItemId(responseId: string, limitMicros: number): string {
  return `${responseId}:cost-limit:${limitMicros}`
}

/** The next limit after the user continues: the first multiple of the threshold above the cost so far. */
export function nextCostLimitMicros(costMicros: number, thresholdMicros: number): number {
  return (Math.floor(costMicros / thresholdMicros) + 1) * thresholdMicros
}

/**
 * Returns the pause item to publish when the response's accrued cost has reached its current limit,
 * or undefined when the run may keep going. A resumed run that was waiting pauses again at the same limit.
 */
export function costLimitPause(options: {
  responseId: string
  thresholdMicros: number | undefined
  costMicros: number
  current: CostLimitItem | undefined
  agentTurn?: number
  now?: Date
}): CostLimitItem | undefined {
  const { responseId, thresholdMicros, costMicros, current } = options
  if (thresholdMicros === undefined) return undefined
  const limitMicros = !current
    ? thresholdMicros
    : current.status === 'awaiting_confirmation'
      ? current.limit_micros
      : nextCostLimitMicros(current.cost_micros, thresholdMicros)
  if (costMicros < limitMicros) return undefined
  return {
    id: costLimitItemId(responseId, limitMicros),
    type: 'pulpo_cost_limit',
    status: 'awaiting_confirmation',
    threshold_micros: thresholdMicros,
    limit_micros: limitMicros,
    cost_micros: costMicros,
    paused_at: (options.now ?? new Date()).toISOString(),
    ...(options.agentTurn ? { agent_turn: options.agentTurn } : {}),
  }
}

function continueKey(responseId: string): string {
  return `pulpo:response:${responseId}:cost-limit-continue`
}

/** Records the user's confirmation for the pause at limitMicros; a stale confirmation cannot approve a later pause. */
export async function requestCostLimitContinue(responseId: string, limitMicros: number): Promise<void> {
  await redis.set(continueKey(responseId), String(limitMicros), 'EX', 86_400)
}

export type CostLimitApproval = {
  read: () => Promise<string | null>
  clear: () => Promise<unknown>
}

export function redisCostLimitApproval(responseId: string): CostLimitApproval {
  return {
    read: () => redis.get(continueKey(responseId)),
    clear: () => redis.del(continueKey(responseId)),
  }
}

/** Waits until the user continues past limitMicros, or the run is aborted (cancellation or timeout). */
export async function waitForCostLimitDecision(options: {
  limitMicros: number
  approval: CostLimitApproval
  signal?: AbortSignal
  pollMs?: number
}): Promise<'continue' | 'stopped'> {
  const { limitMicros, approval, signal, pollMs = 500 } = options
  while (!signal?.aborted) {
    if (await approval.read() === String(limitMicros)) {
      await approval.clear()
      return 'continue'
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, pollMs)
      signal?.addEventListener('abort', done, { once: true })
      function done() {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        resolve()
      }
    })
  }
  return 'stopped'
}
