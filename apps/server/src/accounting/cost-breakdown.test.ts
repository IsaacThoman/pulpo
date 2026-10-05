import { describe, expect, it } from 'vitest'
import { itemizeUsageCost } from './cost-breakdown.js'

describe('itemizeUsageCost', () => {
  it('attributes the remainder to the model and orders metered lines by cost', () => {
    expect(itemizeUsageCost({
      incurredMicros: 67_500,
      chargedMicros: 67_500,
      tokens: 15_147,
      tools: [
        { name: 'web_fetch', calls: 1, costMicros: 5_000 },
        { name: 'web_search', calls: 10, costMicros: 50_000 },
        { name: 'bash', calls: 4, costMicros: 0 },
      ],
      tasks: [{ name: 'title', calls: 1, costMicros: 500 }],
      workspace: { minutes: 3, costMicros: 2_000 },
    })).toEqual([
      { kind: 'model', quantity: 15_147, costMicros: 10_000 },
      { kind: 'tool', name: 'web_search', quantity: 10, costMicros: 50_000 },
      { kind: 'tool', name: 'web_fetch', quantity: 1, costMicros: 5_000 },
      { kind: 'task', name: 'title', quantity: 1, costMicros: 500 },
      { kind: 'workspace', quantity: 3, costMicros: 2_000 },
    ])
  })

  it('omits lines without a charge', () => {
    expect(itemizeUsageCost({
      incurredMicros: 1_000,
      chargedMicros: 1_000,
      tokens: 20,
      tools: [],
      tasks: [],
      workspace: { minutes: 0, costMicros: 0 },
    })).toEqual([{ kind: 'model', quantity: 20, costMicros: 1_000 }])
    expect(itemizeUsageCost({ incurredMicros: 0, chargedMicros: 0, tokens: 0, tools: [], tasks: [] })).toEqual([])
  })

  it('reconciles an absorbed overrun so the lines sum to the charge', () => {
    const items = itemizeUsageCost({
      incurredMicros: 1_937,
      chargedMicros: 1_500,
      tokens: 101,
      tools: [{ name: 'web_search', calls: 1, costMicros: 937 }],
      tasks: [],
    })
    expect(items.at(-1)).toEqual({ kind: 'waived', quantity: 0, costMicros: -437 })
    expect(items.reduce((sum, item) => sum + item.costMicros, 0)).toBe(1_500)
  })
})
