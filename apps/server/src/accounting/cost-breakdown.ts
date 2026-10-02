import type { UsageCostItem } from '@pulpo/contracts'

export interface ItemizedCharge {
  name: string
  calls: number
  costMicros: number
}

/**
 * Splits a settled charge into the lines shown on usage records. Tools, internal
 * tasks, and workspace time are metered separately; the model line is whatever
 * remains of the incurred cost, and a waived line reconciles any shortfall so the
 * items always sum to the charged amount.
 */
export function itemizeUsageCost(input: {
  incurredMicros: number
  chargedMicros: number
  tokens: number
  tools: ItemizedCharge[]
  tasks: ItemizedCharge[]
  workspace?: { minutes: number; costMicros: number } | null
}): UsageCostItem[] {
  const byCost = (a: ItemizedCharge, b: ItemizedCharge) => b.costMicros - a.costMicros || a.name.localeCompare(b.name)
  const metered: UsageCostItem[] = [
    ...input.tools.filter((row) => row.costMicros > 0).sort(byCost)
      .map((row) => ({ kind: 'tool' as const, name: row.name, quantity: row.calls, costMicros: row.costMicros })),
    ...input.tasks.filter((row) => row.costMicros > 0).sort(byCost)
      .map((row) => ({ kind: 'task' as const, name: row.name, quantity: row.calls, costMicros: row.costMicros })),
    ...(input.workspace && input.workspace.costMicros > 0
      ? [{ kind: 'workspace' as const, quantity: input.workspace.minutes, costMicros: input.workspace.costMicros }]
      : []),
  ]
  const modelMicros = input.incurredMicros - metered.reduce((sum, item) => sum + item.costMicros, 0)
  const items: UsageCostItem[] = [
    ...(modelMicros > 0 ? [{ kind: 'model' as const, quantity: input.tokens, costMicros: modelMicros }] : []),
    ...metered,
  ]
  const waivedMicros = items.reduce((sum, item) => sum + item.costMicros, 0) - input.chargedMicros
  if (waivedMicros > 0) items.push({ kind: 'waived', quantity: 0, costMicros: -waivedMicros })
  return items
}
