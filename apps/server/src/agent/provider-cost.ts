export type ProviderCostCapture = {
  fetch: typeof globalThis.fetch
  costMicros: () => Promise<number | undefined>
}

function providerReportedCostMicros(usage: unknown): number | undefined {
  const cost = (usage as { cost?: unknown } | null | undefined)?.cost
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return undefined
  return Math.round(cost * 1_000_000)
}

function costFromPayload(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value = payload as { response?: { usage?: unknown }; usage?: unknown }
  return providerReportedCostMicros(value.response?.usage ?? value.usage)
}

async function responseCostMicros(response: Response): Promise<number | undefined> {
  try {
    const body = await response.text()
    const costs: number[] = []
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data || data === '[DONE]') continue
      try {
        const cost = costFromPayload(JSON.parse(data))
        if (cost !== undefined) costs.push(cost)
      } catch { /* ignore non-JSON provider events */ }
    }
    if (!costs.length) {
      try {
        const cost = costFromPayload(JSON.parse(body))
        if (cost !== undefined) costs.push(cost)
      } catch { /* ignore non-JSON response bodies */ }
    }
    return costs.at(-1)
  } catch {
    return undefined
  }
}

export function createProviderCostCapture(
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): ProviderCostCapture {
  const observations: Array<Promise<number | undefined>> = []
  return {
    fetch: async (input, init) => {
      const response = await baseFetch(input, init)
      observations.push(responseCostMicros(response.clone()))
      return response
    },
    costMicros: async () => {
      const costs = await Promise.all(observations)
      return costs.findLast((cost) => cost !== undefined)
    },
  }
}
