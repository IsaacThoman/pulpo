import { describe, expect, it } from 'vitest'
import { agentSettlementAmounts } from './settlement.js'

describe('agentSettlementAmounts', () => {
  it('bills tools and workspace when subscription inference reports zero tokens', () => {
    expect(agentSettlementAmounts({
      totalTokens: 0,
      generationCostMicros: 0,
      webToolCostMicros: 25_000,
      sidecarCostMicros: 0,
      workspaceCostMicros: 50_000,
    })).toEqual({
      shouldSettle: true,
      costMicrosOverride: 25_000,
      additionalCostMicros: 50_000,
    })
  })

  it('settles zero-cost subscription inference so token usage is recorded', () => {
    expect(agentSettlementAmounts({
      totalTokens: 100,
      generationCostMicros: 0,
      webToolCostMicros: 0,
      sidecarCostMicros: 0,
      workspaceCostMicros: 0,
    }).shouldSettle).toBe(true)
  })
})
