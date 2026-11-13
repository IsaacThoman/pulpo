/** Daily totals with a per-model breakdown, for stacked usage charts. */
export interface DailyModelUsage {
  date: string // yyyy-mm-dd
  calls: number
  tokens: number
  cost: number
  models: { modelId: string; calls: number; tokens: number; cost: number }[]
}

export interface SettledDailyRow {
  day: string
  modelId?: string
  calls: number
  inputTokens: number
  outputTokens: number
  costMicros: number
}

function dateKey(day: string): string {
  return day.slice(0, 10)
}

export function toDailyModelUsage(rows: SettledDailyRow[]): DailyModelUsage[] {
  const days = new Map<string, DailyModelUsage>()
  for (const row of rows) {
    const date = dateKey(row.day)
    const current = days.get(date) ?? { date, calls: 0, tokens: 0, cost: 0, models: [] }
    const tokens = row.inputTokens + row.outputTokens
    const cost = row.costMicros / 1_000_000
    current.calls += row.calls
    current.tokens += tokens
    current.cost += cost
    if (row.modelId) current.models.push({ modelId: row.modelId, calls: row.calls, tokens, cost })
    days.set(date, current)
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}
