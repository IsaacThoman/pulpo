import { approxTokenCount, approxTokensFromBytes, utf8ByteLength } from './truncate.js'

/** Codex RESIZED_IMAGE_BYTES_ESTIMATE (7373 bytes) / 4. */
export const IMAGE_TOKEN_ESTIMATE = 1_844
/** Flat estimate for an attached file whose size is unknown (opencode uses 2,000 per PDF). */
export const FILE_TOKEN_ESTIMATE = 2_000

export type ContextTokenCount = { tokens: number; source: 'usage' | 'estimate' }
type PiContext = { systemPrompt?: string; messages: readonly unknown[]; tools?: readonly unknown[] }

/** Model-visible bytes plus flat-rate parts (images, files); converted to tokens once per item. */
type Cost = { bytes: number; tokens: number }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const textBytes = (value: unknown) => typeof value === 'string' ? utf8ByteLength(value) : 0
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

/** Sum without an intermediate array; trimming sums the whole history after every drop. */
function sumOf<T>(values: readonly T[], value: (item: T) => number): number {
  let total = 0
  for (const item of values) total += value(item)
  return total
}
const toTokens = (cost: Cost) => approxTokensFromBytes(cost.bytes) + cost.tokens

// History elements are never mutated once in a context, so estimates are cached
// per object; trimming re-estimates the whole history after every drop.
const piMessageEstimates = new WeakMap<object, number>()
const responsesItemEstimates = new WeakMap<object, number>()

function memoized<T extends object>(cache: WeakMap<object, number>, value: T, estimate: (value: T) => number): number {
  const cached = cache.get(value)
  if (cached !== undefined) return cached
  const tokens = estimate(value)
  cache.set(value, tokens)
  return tokens
}

function jsonBytes(value: unknown): number {
  if (typeof value === 'string') return utf8ByteLength(value)
  return textBytes(JSON.stringify(value ?? {}))
}

/** Codex estimate_reasoning_length for an opaque base64 reasoning payload. */
function encryptedBytes(length: number): number {
  return Math.max(0, Math.floor(length * 3 / 4) - 650)
}

function encryptedContentLength(signature: unknown): number | undefined {
  if (typeof signature !== 'string' || !signature.startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(signature)
    return isRecord(parsed) && typeof parsed.encrypted_content === 'string' ? parsed.encrypted_content.length : undefined
  } catch {
    return undefined
  }
}

function piPartCost(part: unknown): Cost {
  if (!isRecord(part)) return { bytes: 0, tokens: 0 }
  switch (part.type) {
    case 'text':
      return { bytes: textBytes(part.text), tokens: 0 }
    case 'image':
      return { bytes: 0, tokens: IMAGE_TOKEN_ESTIMATE }
    case 'thinking': {
      if (part.redacted === true) return { bytes: Math.floor(textBytes(part.thinkingSignature) * 3 / 4), tokens: 0 }
      const encrypted = encryptedContentLength(part.thinkingSignature)
      return { bytes: encrypted === undefined ? textBytes(part.thinking) : encryptedBytes(encrypted), tokens: 0 }
    }
    case 'redactedThinking':
    case 'redacted_thinking':
      return { bytes: Math.floor(textBytes(part.data ?? part.signature) * 3 / 4), tokens: 0 }
    case 'toolCall':
      return { bytes: textBytes(part.name) + jsonBytes(part.arguments), tokens: 0 }
    default:
      return { bytes: 0, tokens: 0 }
  }
}

function piContentCost(content: unknown): Cost {
  if (typeof content === 'string') return { bytes: utf8ByteLength(content), tokens: 0 }
  if (!Array.isArray(content)) return { bytes: 0, tokens: 0 }
  const parts = content.map(piPartCost)
  return { bytes: sum(parts.map((part) => part.bytes)), tokens: sum(parts.map((part) => part.tokens)) }
}

/** pi-ai Message / pi-agent-core AgentMessage; ids, usage, details and signatures are not model-visible. */
export function estimatePiMessageTokens(message: unknown): number {
  return isRecord(message) ? memoized(piMessageEstimates, message, piMessageTokens) : 0
}

function piMessageTokens(message: Record<string, unknown>): number {
  if (message.role === 'user' || message.role === 'assistant') return toTokens(piContentCost(message.content))
  if (message.role !== 'toolResult') return 0
  const cost = piContentCost(message.content)
  return toTokens({ bytes: cost.bytes + textBytes(message.toolName) + textBytes(message.toolCallId), tokens: cost.tokens })
}

export function estimatePiToolsTokens(tools: readonly unknown[] | undefined): number {
  if (!tools?.length) return 0
  return approxTokensFromBytes(sum(tools.map((tool) => isRecord(tool)
    ? textBytes(tool.name) + textBytes(tool.description) + jsonBytes(tool.parameters)
    : 0)))
}

/** Full context size reported by the provider for an assistant message; 0 when missing. */
export function piUsageTokens(message: unknown): number {
  if (!isRecord(message) || message.role !== 'assistant' || !isRecord(message.usage)) return 0
  const usage = message.usage
  return count(usage.input) + count(usage.cacheRead) + count(usage.cacheWrite) + count(usage.output)
}

function isUsageAnchor(message: unknown): boolean {
  return isRecord(message)
    && message.role === 'assistant'
    && message.stopReason !== 'error'
    && message.stopReason !== 'aborted'
    && piUsageTokens(message) > 0
}

export function piFullEstimate(context: PiContext): number {
  return approxTokenCount(context.systemPrompt ?? '')
    + estimatePiToolsTokens(context.tools)
    + sumOf(context.messages, estimatePiMessageTokens)
}

/** Codex get_total_token_usage: last real usage plus an estimate of what was added since. */
export function piContextTokens(context: PiContext): ContextTokenCount {
  const { messages } = context
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!isUsageAnchor(messages[index])) continue
    return {
      tokens: piUsageTokens(messages[index]) + sum(messages.slice(index + 1).map(estimatePiMessageTokens)),
      source: 'usage',
    }
  }
  return { tokens: piFullEstimate(context), source: 'estimate' }
}

const RESPONSES_TEXT_PARTS = new Set(['input_text', 'output_text', 'text', 'summary_text'])

function responsesPartCost(part: unknown): Cost {
  if (typeof part === 'string') return { bytes: utf8ByteLength(part), tokens: 0 }
  if (!isRecord(part)) return { bytes: 0, tokens: 0 }
  if (typeof part.type === 'string' && RESPONSES_TEXT_PARTS.has(part.type)) return { bytes: textBytes(part.text), tokens: 0 }
  if (part.type === 'refusal') return { bytes: textBytes(part.refusal ?? part.text), tokens: 0 }
  if (part.type === 'input_image') return { bytes: 0, tokens: IMAGE_TOKEN_ESTIMATE }
  if (part.type === 'input_file') return { bytes: 0, tokens: FILE_TOKEN_ESTIMATE }
  return { bytes: jsonBytes(part), tokens: 0 }
}

function responsesContentCost(content: unknown): Cost {
  if (typeof content === 'string') return { bytes: utf8ByteLength(content), tokens: 0 }
  if (!Array.isArray(content)) return { bytes: 0, tokens: 0 }
  const parts = content.map(responsesPartCost)
  return { bytes: sum(parts.map((part) => part.bytes)), tokens: sum(parts.map((part) => part.tokens)) }
}

/** Responses-style input or output item. */
export function estimateResponsesItemTokens(item: unknown): number {
  return isRecord(item) ? memoized(responsesItemEstimates, item, responsesItemTokens) : 0
}

function responsesItemTokens(item: Record<string, unknown>): number {
  const type = item.type
  if (typeof type === 'string' && type.startsWith('pulpo_')) return 0
  if (type === 'message' || (type === undefined && typeof item.role === 'string')) return toTokens(responsesContentCost(item.content))
  if (type === 'reasoning') {
    const summary = responsesContentCost(item.summary)
    const encrypted = typeof item.encrypted_content === 'string' ? encryptedBytes(item.encrypted_content.length) : 0
    return toTokens({ bytes: summary.bytes + encrypted, tokens: summary.tokens })
  }
  if (type === 'function_call') return approxTokensFromBytes(textBytes(item.name) + jsonBytes(item.arguments))
  if (type === 'function_call_output') return toTokens(responsesContentCost(item.output))
  // Unknown items: count the whole JSON so new item kinds are never free.
  return approxTokensFromBytes(JSON.stringify(item).length)
}

export function estimateResponsesItemsTokens(items: readonly unknown[]): number {
  return sumOf(items, estimateResponsesItemTokens)
}

/** Context size of a completed non-agent response; agent usage is cumulative across turns. */
export function responseUsageAnchor(
  response: { status: string; agentMode: boolean; usage: unknown } | undefined,
  options?: { excludeReasoning?: boolean },
): number | undefined {
  if (!response || response.status !== 'completed' || response.agentMode || !isRecord(response.usage)) return undefined
  // inputTokens already includes cached and cache-write tokens.
  const input = count(response.usage.inputTokens)
  const output = count(response.usage.outputTokens)
  if (input + output <= 0) return undefined
  const reasoning = options?.excludeReasoning ? Math.min(output, count(response.usage.reasoningTokens)) : 0
  return input + output - reasoning
}
