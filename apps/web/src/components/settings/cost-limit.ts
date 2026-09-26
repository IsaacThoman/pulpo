import { AGENT_COST_LIMIT_MAX_MICROS, AGENT_COST_LIMIT_MIN_MICROS } from '@pulpo/contracts'

/** Parses a dollar amount into clamped USD micros, or undefined when it is not a number. */
export function parseCostLimit(raw: string): number | undefined {
  const dollars = Number(raw.trim().replace(/^\$/, ''))
  if (!raw.trim() || !Number.isFinite(dollars)) return undefined
  const micros = Math.round(dollars * 100) * 10_000
  return Math.min(AGENT_COST_LIMIT_MAX_MICROS, Math.max(AGENT_COST_LIMIT_MIN_MICROS, micros))
}
