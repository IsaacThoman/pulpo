export interface AgentSettlementAmounts {
  shouldSettle: boolean
  costMicrosOverride: number
  additionalCostMicros: number
}

export function agentSettlementAmounts(input: {
  totalTokens: number
  generationCostMicros: number
  webToolCostMicros: number
  sidecarCostMicros: number
  postTaskCostMicros?: number
  workspaceCostMicros: number
}): AgentSettlementAmounts {
  const costMicrosOverride = Math.max(0, input.generationCostMicros) + Math.max(0, input.webToolCostMicros)
  const additionalCostMicros = Math.max(0, input.sidecarCostMicros)
    + Math.max(0, input.postTaskCostMicros ?? 0)
    + Math.max(0, input.workspaceCostMicros)
  return {
    shouldSettle: input.totalTokens > 0 || costMicrosOverride > 0 || additionalCostMicros > 0,
    costMicrosOverride,
    additionalCostMicros,
  }
}
