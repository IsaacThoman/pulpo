export type AnthropicModelCapabilities = {
  /** Accepts `thinking: {type: "adaptive"}` with `output_config.effort`. */
  adaptiveThinking: boolean
  /** Thinking cannot be disabled; lowering effort is the only control. */
  thinkingAlwaysOn: boolean
  /** Accepts non-default `temperature` / `top_p`. */
  sampling: boolean
  efforts: ReadonlySet<string>
}

const BASE_EFFORTS = ['low', 'medium', 'high']

/**
 * Parse `claude-<family>-<major>[-<minor>]` from first-party, Bedrock
 * (`anthropic.` / `us.anthropic.` / `global.anthropic.` prefixes, `-v1:0`
 * suffixes), Vertex (`@date`), and gateway (`anthropic/claude-opus-4.6`) model ids. Dated snapshots carry an eight-digit suffix, which is
 * never mistaken for a minor version.
 */
export function claudeModelVersion(upstreamModelId: string): { family: string; major: number; minor: number } | undefined {
  const id = upstreamModelId.toLowerCase().replace(/^(?:[a-z-]+\.)?anthropic\./, '').split('@')[0]!
  const modern = /(?:^|[/:])claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d{1,2})(?!\d))?/.exec(id)
  if (modern) return { family: modern[1]!, major: Number(modern[2]), minor: Number(modern[3] ?? 0) }
  const legacy = /(?:^|[/:])claude-(\d+)(?:[-.](\d))?-(opus|sonnet|haiku)/.exec(id)
  if (legacy) return { family: legacy[3]!, major: Number(legacy[1]), minor: Number(legacy[2] ?? 0) }
  return undefined
}

function atLeast(version: { major: number; minor: number }, major: number, minor: number): boolean {
  return version.major > major || (version.major === major && version.minor >= minor)
}

/**
 * Request-shape rules per Claude generation. Unknown models (including
 * Anthropic-compatible servers hosting other models) get the conservative
 * budget-thinking shape, which those servers implement most widely.
 */
export function anthropicModelCapabilities(upstreamModelId: string): AnthropicModelCapabilities {
  const version = claudeModelVersion(upstreamModelId)
  if (!version) return { adaptiveThinking: false, thinkingAlwaysOn: false, sampling: true, efforts: new Set(BASE_EFFORTS) }
  const { family } = version
  if (family === 'fable' || family === 'mythos') {
    return { adaptiveThinking: true, thinkingAlwaysOn: true, sampling: false, efforts: new Set([...BASE_EFFORTS, 'xhigh', 'max']) }
  }
  if (family === 'opus') {
    const adaptive = atLeast(version, 4, 6)
    return {
      adaptiveThinking: adaptive,
      thinkingAlwaysOn: atLeast(version, 5, 5),
      sampling: !atLeast(version, 4, 7),
      efforts: new Set([...BASE_EFFORTS, ...(adaptive ? ['max'] : []), ...(atLeast(version, 4, 7) ? ['xhigh'] : [])]),
    }
  }
  if (family === 'sonnet') {
    const adaptive = atLeast(version, 4, 6)
    return {
      adaptiveThinking: adaptive,
      thinkingAlwaysOn: atLeast(version, 5, 5),
      sampling: !atLeast(version, 5, 0),
      efforts: new Set([...BASE_EFFORTS, ...(adaptive ? ['max'] : []), ...(atLeast(version, 5, 0) ? ['xhigh'] : [])]),
    }
  }
  return { adaptiveThinking: false, thinkingAlwaysOn: false, sampling: true, efforts: new Set(BASE_EFFORTS) }
}

/** Map a Responses `reasoning.effort` onto an effort level this model accepts. */
export function anthropicEffort(effort: string, capabilities: AnthropicModelCapabilities): string {
  if (effort === 'minimal' || effort === 'none') return 'low'
  if (capabilities.efforts.has(effort)) return effort
  // Unsupported top levels degrade to the strongest universally accepted level.
  if (effort === 'xhigh' || effort === 'max') return 'high'
  return 'medium'
}

const BUDGET_BY_EFFORT: Record<string, number> = {
  minimal: 1_024, low: 2_048, medium: 8_192, high: 16_384, xhigh: 32_000, max: 32_000,
}

/** Budget-thinking models need `budget_tokens >= 1024` and below `max_tokens`. */
export function thinkingBudget(effort: string, maxTokens: number): number | undefined {
  const budget = Math.min(BUDGET_BY_EFFORT[effort] ?? 8_192, maxTokens - 1_024)
  return budget >= 1_024 ? budget : undefined
}
