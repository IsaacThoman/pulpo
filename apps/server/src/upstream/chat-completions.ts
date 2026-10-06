import type OpenAI from 'openai'
import { createHash } from 'node:crypto'
import {
  functionTools,
  isTextMediaType,
  neutralConversation,
  neutralTextFormat,
  neutralToolChoice,
  parseDataUrl,
  partsText,
  passthroughParameters,
  estimateTokensExcludingMedia,
  reasoningEffort,
  type NeutralEntry,
  type NeutralPart,
} from './responses-input.js'
import { ResponsesStreamBuilder, responsesUsage, type ResponsesStreamEvent, type ResponsesUsage } from './responses-builder.js'
import { MAX_PARAMETER_RETRIES, logParameterRetry, rejectedOptionalParameter, withoutKey } from './parameter-retry.js'
import { upstreamErrorDetails } from '../responses/upstream-request.js'

type JsonRecord = Record<string, unknown>
type ChatMessage = JsonRecord & { role: string }
type ChatFormat = 'openai_chat_completions' | 'mistral_chat_completions'

/** Mistral puts ordered answer and thinking chunks in the same content field. */
export function mistralContentParts(content: unknown): Array<{ type: 'text' | 'thinking'; text: string }> {
  if (content === undefined || content === null) return []
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  if (!Array.isArray(content)) throw new UpstreamStreamError('Unsupported Mistral content shape', 502)
  return content.flatMap<{ type: 'text' | 'thinking'; text: string }>((raw) => {
    if (typeof raw === 'string') return raw ? [{ type: 'text' as const, text: raw }] : []
    const part = record(raw)
    if (part?.type === 'text' && typeof part.text === 'string') return part.text ? [{ type: 'text' as const, text: part.text }] : []
    if (part?.type === 'thinking' && Array.isArray(part.thinking)) {
      const text = part.thinking.map((inner) => {
        const nested = record(inner)
        if (nested?.type !== 'text' || typeof nested.text !== 'string') throw new UpstreamStreamError('Unsupported Mistral thinking shape', 502)
        return nested.text
      }).join('')
      return text ? [{ type: 'thinking' as const, text }] : []
    }
    throw new UpstreamStreamError('Unsupported Mistral content chunk', 502)
  })
}

function appendMistralPart(messages: ChatMessage[], part: JsonRecord): void {
  let target = messages.at(-1)
  if (target?.role !== 'assistant') {
    target = { role: 'assistant', content: [] }
    messages.push(target)
  }
  const content = Array.isArray(target.content) ? target.content : []
  target.content = [...content, part]
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function hostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** OpenRouter accepts Anthropic-style top-level `cache_control`; other Chat Completions servers do not. */
export function acceptsCacheControl(baseUrl: string): boolean {
  const host = hostname(baseUrl)
  return host === 'openrouter.ai' || host.endsWith('.openrouter.ai')
}

/** OpenAI's own endpoints reject `max_tokens` on reasoning models; most compatible servers only know `max_tokens`. */
export function prefersMaxCompletionTokens(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === 'api.openai.com' || hostname.endsWith('.openai.azure.com') || hostname.endsWith('.services.ai.azure.com')
  } catch {
    return false
  }
}

function userContent(parts: NeutralPart[]): string | JsonRecord[] {
  if (parts.every((part) => part.type === 'text')) return partsText(parts)
  return parts.map((part): JsonRecord => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image') return { type: 'image_url', image_url: { url: part.url, ...(part.detail ? { detail: part.detail } : {}) } }
    if (part.fileData) {
      const parsed = parseDataUrl(part.fileData)
      if (parsed && isTextMediaType(parsed.mediaType)) {
        return { type: 'text', text: `${part.filename ? `File ${part.filename}:\n` : ''}${Buffer.from(parsed.data, 'base64').toString('utf8')}` }
      }
      return { type: 'file', file: { ...(part.filename ? { filename: part.filename } : {}), file_data: part.fileData } }
    }
    return { type: 'file', file: { file_id: part.fileId } }
  })
}

/**
 * Chat templates on many servers accept a single leading system message only,
 * so every system/developer entry is hoisted into one message, in order.
 */
export function chatMessagesFromEntries(entries: NeutralEntry[], options: { model?: string; format?: ChatFormat } = {}): ChatMessage[] {
  const mistral = options.format === 'mistral_chat_completions'
  // Mistral requires nine alphanumeric characters, including imported tool history.
  const callIds = new Map<string, string>()
  const usedIds = new Set(entries.flatMap(entry => entry.kind === 'function_call' && /^[a-zA-Z0-9]{9}$/.test(entry.callId) ? [entry.callId] : []))
  const callId = (id: string) => {
    if (!mistral || /^[a-zA-Z0-9]{9}$/.test(id)) return id
    const existing = callIds.get(id)
    if (existing) return existing
    let candidate = ''
    let salt = 0
    do { candidate = createHash('sha256').update(`${id}:${salt++}`).digest('hex').slice(0, 9) } while (usedIds.has(candidate))
    callIds.set(id, candidate)
    usedIds.add(candidate)
    return candidate
  }
  const system = entries.flatMap((entry) => entry.kind === 'system' ? [entry.text.trim()] : []).filter(Boolean)
  const messages: ChatMessage[] = system.length ? [{ role: 'system', content: system.join('\n\n') }] : []
  let pendingImages: JsonRecord[] = []
  const flushImages = () => {
    if (!pendingImages.length) return
    messages.push({ role: 'user', content: [{ type: 'text', text: 'Images returned by the tool calls above:' }, ...pendingImages] })
    pendingImages = []
  }
  // Thinking models such as DeepSeek and Kimi require their reasoning back on
  // tool-calling turns; only reasoning this same model produced is replayed.
  let pendingReasoning = ''
  for (const entry of entries) {
    if (entry.kind === 'system') continue
    if (entry.kind === 'reasoning') {
      if (mistral) {
        if (entry.reasoning.format === 'mistral_chat_completions' && entry.reasoning.model === options.model && entry.reasoning.text) {
          appendMistralPart(messages, { type: 'thinking', thinking: [{ type: 'text', text: entry.reasoning.text }] })
        }
        continue
      }
      const own = entry.reasoning.format === 'openai_chat_completions' && (!options.model || entry.reasoning.model === options.model)
      pendingReasoning = own && entry.reasoning.text ? `${pendingReasoning}${entry.reasoning.text}` : pendingReasoning
      continue
    }
    if (entry.kind !== 'function_output') flushImages()
    if (entry.kind === 'user') {
      pendingReasoning = ''
      messages.push({ role: 'user', content: userContent(entry.parts) })
    } else if (entry.kind === 'assistant') {
      if (mistral) {
        appendMistralPart(messages, { type: 'text', text: entry.text })
        continue
      }
      const previous = messages.at(-1)
      // One assistant turn carries all of its text and calls; tool messages must follow it directly.
      if (previous?.role === 'assistant') previous.content = `${typeof previous.content === 'string' ? previous.content : ''}${entry.text}`
      else messages.push({ role: 'assistant', content: entry.text })
    } else if (entry.kind === 'function_call') {
      const previous = messages.at(-1)
      const call = { id: callId(entry.callId), type: 'function', function: { name: entry.name, arguments: entry.arguments || '{}' } }
      const target = previous?.role === 'assistant' ? previous : { role: 'assistant', content: null }
      if (target !== previous) messages.push(target)
      target.tool_calls = [...(target.tool_calls as unknown[] | undefined ?? []), call]
      if (pendingReasoning && target.reasoning_content === undefined) target.reasoning_content = pendingReasoning
      pendingReasoning = ''
    } else {
      const text = entry.output.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n')
      const images = entry.output.filter((part) => part.type === 'image')
      messages.push({ role: 'tool', tool_call_id: callId(entry.callId), content: text || (images.length ? '[image output follows]' : '') })
      pendingImages.push(...images.map((part) => ({ type: 'image_url', image_url: { url: part.type === 'image' ? part.url : '' } })))
    }
  }
  flushImages()
  return messages
}

/** Translate a Responses API request body into a Chat Completions request body. */
export function chatCompletionsRequest(payload: JsonRecord, options: { baseUrl: string; stream: boolean; format?: ChatFormat }): JsonRecord {
  const entries = neutralConversation(payload)
  const tools = functionTools(payload.tools)
  const toolChoice = neutralToolChoice(payload.tool_choice)
  const format = neutralTextFormat(payload.text)
  const effort = reasoningEffort(payload.reasoning)
  const verbosity = record(payload.text)?.verbosity
  const maxTokens = typeof payload.max_output_tokens === 'number' ? payload.max_output_tokens : undefined
  const body: JsonRecord = {
    ...passthroughParameters(payload),
    model: payload.model,
    messages: chatMessagesFromEntries(entries, { model: typeof payload.model === 'string' ? payload.model : undefined, format: options.format }),
    ...(maxTokens !== undefined ? { [prefersMaxCompletionTokens(options.baseUrl) ? 'max_completion_tokens' : 'max_tokens']: maxTokens } : {}),
    ...(typeof payload.temperature === 'number' ? { temperature: payload.temperature } : {}),
    ...(typeof payload.top_p === 'number' ? { top_p: payload.top_p } : {}),
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(typeof verbosity === 'string' ? { verbosity } : {}),
    ...(tools.length ? {
      tools: tools.map((tool) => ({ type: 'function', function: tool })),
      ...(toolChoice ? { tool_choice: typeof toolChoice === 'string' ? toolChoice : { type: 'function', function: { name: toolChoice.name } } } : {}),
      ...(typeof payload.parallel_tool_calls === 'boolean' ? { parallel_tool_calls: payload.parallel_tool_calls } : {}),
    } : {}),
    ...(format?.type === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
    ...(format?.type === 'json_schema' ? { response_format: { type: 'json_schema', json_schema: {
      name: format.name, schema: format.schema,
      ...(format.description ? { description: format.description } : {}),
      ...(format.strict !== undefined ? { strict: format.strict } : {}),
    } } } : {}),
    ...(typeof payload.service_tier === 'string' ? { service_tier: payload.service_tier } : {}),
    ...(typeof payload.prompt_cache_key === 'string' ? { prompt_cache_key: payload.prompt_cache_key } : {}),
    ...(typeof payload.safety_identifier === 'string' ? { safety_identifier: payload.safety_identifier } : {}),
    ...(record(payload.cache_control) && acceptsCacheControl(options.baseUrl) ? { cache_control: payload.cache_control } : {}),
    ...(options.stream ? { stream: true, stream_options: { include_usage: true } } : { stream: false }),
  }
  return body
}

const OPTIONAL_CHAT_PARAMETERS = new Set([
  'temperature', 'top_p', 'reasoning_effort', 'verbosity', 'service_tier', 'parallel_tool_calls',
  'prompt_cache_key', 'safety_identifier', 'response_format', 'cache_control',
])

/**
 * Swap between `max_tokens` and `max_completion_tokens` when a server rejects
 * the one we sent. Context-length errors name both fields and are not swaps.
 */
function swappedTokenLimit(error: unknown, body: JsonRecord): JsonRecord | undefined {
  if (/context|too (?:large|long|many)|exceed|maximum/i.test(upstreamErrorDetails(error).message)) return undefined
  const key = rejectedOptionalParameter(error, body, new Set(['max_tokens', 'max_completion_tokens']))
  if (!key) return undefined
  const other = key === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
  if (other in body) return undefined
  return { ...withoutKey(body, key), [other]: body[key] }
}

export function chatUsage(raw: unknown): ResponsesUsage | null {
  const usage = record(raw)
  if (!usage) return null
  const promptDetails = record(usage.prompt_tokens_details) ?? {}
  const completionDetails = record(usage.completion_tokens_details) ?? {}
  const cached = Number(promptDetails.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0)
  return responsesUsage({
    inputTokens: Number(usage.prompt_tokens ?? 0),
    cachedInputTokens: Number.isFinite(cached) ? cached : 0,
    cacheWriteTokens: Number(promptDetails.cache_write_tokens ?? 0) || 0,
    outputTokens: Number(usage.completion_tokens ?? 0),
    reasoningTokens: Number(completionDetails.reasoning_tokens ?? 0) || 0,
    ...(typeof usage.cost === 'number' ? { cost: usage.cost } : {}),
  })
}

function incompleteReason(finishReason: unknown): string | null {
  if (finishReason === 'length') return 'max_output_tokens'
  if (finishReason === 'content_filter') return 'content_filter'
  return null
}

export class UpstreamStreamError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string, readonly type?: string) {
    super(message)
    this.name = 'UpstreamStreamError'
  }
}

function chunkError(chunk: JsonRecord): UpstreamStreamError | undefined {
  const error = record(chunk.error)
  if (!error) return undefined
  const status = typeof error.code === 'number' ? error.code : typeof error.status === 'number' ? error.status : undefined
  return new UpstreamStreamError(
    typeof error.message === 'string' ? error.message : 'Provider stream failed',
    status,
    typeof error.code === 'string' ? error.code : undefined,
    typeof error.type === 'string' ? error.type : undefined,
  )
}

/**
 * Translate Chat Completions stream chunks into Responses API events.
 * `estimatedInputTokens` stands in for usage when a server never reports it,
 * so the generation is still billed.
 */
export async function* translateChatStream(chunks: AsyncIterable<unknown>, model: string, options: { estimatedInputTokens?: number; format?: ChatFormat } = {}): AsyncGenerator<ResponsesStreamEvent> {
  const builder = new ResponsesStreamBuilder(options.format ?? 'openai_chat_completions', { model })
  let usage: ResponsesUsage | null = null
  let finishReason: unknown
  // Reasoning that resumes after visible output starts a new reasoning item.
  let reasoningSegment = 0
  const closeReasoning = () => builder.reasoningDone(`reasoning:${reasoningSegment++}`)
  const knownUsage = () => usage ?? responsesUsage({ inputTokens: options.estimatedInputTokens ?? 0, outputTokens: builder.estimatedOutputTokens() })
  try {
  for await (const raw of chunks) {
    const chunk = record(raw)
    if (!chunk) continue
    const failure = chunkError(chunk)
    if (failure) throw failure
    yield* builder.start({ id: typeof chunk.id === 'string' && chunk.id ? chunk.id : undefined, model: typeof chunk.model === 'string' && chunk.model ? chunk.model : undefined })
    if (chunk.usage) usage = chatUsage(chunk.usage) ?? usage
    const choices = Array.isArray(chunk.choices) ? chunk.choices : []
    for (const rawChoice of choices) {
      const choice = record(rawChoice)
      if (!choice || (typeof choice.index === 'number' && choice.index !== 0)) continue
      const delta = record(choice.delta) ?? record(choice.message) ?? {}
      if (options.format === 'mistral_chat_completions') {
        for (const part of mistralContentParts(delta.content)) {
          if (part.type === 'thinking') yield* builder.reasoning(`reasoning:${reasoningSegment}`, part.text)
          else {
            if (builder.hasReasoning(`reasoning:${reasoningSegment}`)) yield* closeReasoning()
            yield* builder.text(part.text)
          }
        }
      }
      const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content
        : typeof delta.reasoning === 'string' ? delta.reasoning : ''
      if (reasoning) yield* builder.reasoning(`reasoning:${reasoningSegment}`, reasoning)
      if (options.format !== 'mistral_chat_completions' && typeof delta.content === 'string' && delta.content) {
        if (builder.hasReasoning(`reasoning:${reasoningSegment}`)) yield* closeReasoning()
        yield* builder.text(delta.content)
      }
      if (typeof delta.refusal === 'string' && delta.refusal) {
        if (builder.hasReasoning(`reasoning:${reasoningSegment}`)) yield* closeReasoning()
        yield* builder.refusal(delta.refusal)
      }
      if (Array.isArray(delta.tool_calls)) {
        if (builder.hasReasoning(`reasoning:${reasoningSegment}`)) yield* closeReasoning()
        for (const [position, rawCall] of delta.tool_calls.entries()) {
          const call = record(rawCall)
          if (!call) continue
          const key = String(typeof call.index === 'number' ? call.index : position)
          const fn = record(call.function) ?? {}
          yield* builder.functionCall(key, {
            ...(typeof call.id === 'string' && call.id ? { callId: call.id } : {}),
            ...(typeof fn.name === 'string' && fn.name ? { name: fn.name } : {}),
          })
          if (typeof fn.arguments === 'string') yield* builder.functionArguments(key, fn.arguments)
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason
    }
  }
  } catch (error) {
    yield* builder.progress(knownUsage())
    throw error
  }
  // A stream cut off before any finish reason is a failed generation, not a complete one.
  if (finishReason === undefined) {
    yield* builder.progress(knownUsage())
    throw new UpstreamStreamError('Provider stream ended before the response finished', 502)
  }
  if (!usage) console.warn(JSON.stringify({ level: 'warn', service: 'pulpo-worker', event: 'upstream.usage_missing', format: options.format ?? 'openai_chat_completions', model }))
  yield* builder.finish({ usage: knownUsage(), incompleteReason: incompleteReason(finishReason) }).events
}

/** Open a Chat Completions stream, dropping optional parameters the provider rejects. */
export async function openChatCompletionsStream(
  client: OpenAI,
  payload: JsonRecord,
  options: { baseUrl: string; format?: ChatFormat; signal?: AbortSignal; headers?: Record<string, string> },
): Promise<AsyncIterable<ResponsesStreamEvent>> {
  let body = chatCompletionsRequest(payload, { baseUrl: options.baseUrl, format: options.format, stream: true })
  // Operator pass-through knobs degrade like the standard optional ones.
  const optional = new Set([...OPTIONAL_CHAT_PARAMETERS, ...Object.keys(passthroughParameters(payload))])
  if (options.format === 'mistral_chat_completions') optional.delete('reasoning_effort')
  const estimatedInputTokens = estimateTokensExcludingMedia(body.messages)
  let swappedLimit = false
  for (let retries = 0; ; retries += 1) {
    try {
      const stream = await client.chat.completions.create(body as never, { signal: options.signal, headers: options.headers })
      return translateChatStream(stream as unknown as AsyncIterable<unknown>, String(payload.model), { estimatedInputTokens, format: options.format })
    } catch (error) {
      if (retries >= MAX_PARAMETER_RETRIES) throw error
      const swapped = swappedLimit ? undefined : swappedTokenLimit(error, body)
      if (swapped) swappedLimit = true
      const parameter = swapped ? undefined : rejectedOptionalParameter(error, body, optional)
      if (!swapped && !parameter) throw error
      logParameterRetry(options.format ?? 'openai_chat_completions', parameter ?? ('max_tokens' in body ? 'max_tokens' : 'max_completion_tokens'), error instanceof Error ? error.message : String(error))
      body = swapped ?? withoutKey(body, parameter!)
    }
  }
}
