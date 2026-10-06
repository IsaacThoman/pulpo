import type OpenAI from 'openai'
import {
  functionTools,
  isTextMediaType,
  neutralConversation,
  neutralTextFormat,
  neutralToolChoice,
  parseDataUrl,
  partsText,
  passthroughParameters,
  reasoningEffort,
  type NeutralEntry,
  type NeutralPart,
} from './responses-input.js'
import { ResponsesStreamBuilder, responsesUsage, type ResponsesStreamEvent, type ResponsesUsage } from './responses-builder.js'
import { MAX_PARAMETER_RETRIES, logParameterRetry, rejectedOptionalParameter, withoutKey } from './parameter-retry.js'

type JsonRecord = Record<string, unknown>
type ChatMessage = JsonRecord & { role: string }

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
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
export function chatMessagesFromEntries(entries: NeutralEntry[]): ChatMessage[] {
  const system = entries.flatMap((entry) => entry.kind === 'system' ? [entry.text.trim()] : []).filter(Boolean)
  const messages: ChatMessage[] = system.length ? [{ role: 'system', content: system.join('\n\n') }] : []
  let pendingImages: JsonRecord[] = []
  const flushImages = () => {
    if (!pendingImages.length) return
    messages.push({ role: 'user', content: [{ type: 'text', text: 'Images returned by the tool calls above:' }, ...pendingImages] })
    pendingImages = []
  }
  for (const entry of entries) {
    if (entry.kind === 'system' || entry.kind === 'reasoning') continue
    if (entry.kind !== 'function_output') flushImages()
    if (entry.kind === 'user') {
      messages.push({ role: 'user', content: userContent(entry.parts) })
    } else if (entry.kind === 'assistant') {
      const previous = messages.at(-1)
      // Text that follows tool calls in the same turn becomes its own message.
      if (previous?.role === 'assistant' && !previous.tool_calls && typeof previous.content === 'string') previous.content = `${previous.content}${entry.text}`
      else messages.push({ role: 'assistant', content: entry.text })
    } else if (entry.kind === 'function_call') {
      const previous = messages.at(-1)
      const call = { id: entry.callId, type: 'function', function: { name: entry.name, arguments: entry.arguments || '{}' } }
      if (previous?.role === 'assistant') previous.tool_calls = [...(previous.tool_calls as unknown[] | undefined ?? []), call]
      else messages.push({ role: 'assistant', content: null, tool_calls: [call] })
    } else {
      const text = entry.output.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n')
      const images = entry.output.filter((part) => part.type === 'image')
      messages.push({ role: 'tool', tool_call_id: entry.callId, content: text || (images.length ? '[image output follows]' : '') })
      pendingImages.push(...images.map((part) => ({ type: 'image_url', image_url: { url: part.type === 'image' ? part.url : '' } })))
    }
  }
  flushImages()
  return messages
}

/** Translate a Responses API request body into a Chat Completions request body. */
export function chatCompletionsRequest(payload: JsonRecord, options: { baseUrl: string; stream: boolean }): JsonRecord {
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
    messages: chatMessagesFromEntries(entries),
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
    ...(record(payload.cache_control) ? { cache_control: payload.cache_control } : {}),
    ...(options.stream ? { stream: true, stream_options: { include_usage: true } } : { stream: false }),
  }
  return body
}

const OPTIONAL_CHAT_PARAMETERS = new Set([
  'temperature', 'top_p', 'reasoning_effort', 'verbosity', 'service_tier', 'parallel_tool_calls',
  'prompt_cache_key', 'safety_identifier', 'stream_options', 'response_format', 'cache_control',
])

/** Swap between `max_tokens` and `max_completion_tokens` when a server rejects the one we sent. */
function swappedTokenLimit(error: unknown, body: JsonRecord): JsonRecord | undefined {
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

/** Translate Chat Completions stream chunks into Responses API events. */
export async function* translateChatStream(chunks: AsyncIterable<unknown>, model: string): AsyncGenerator<ResponsesStreamEvent> {
  const builder = new ResponsesStreamBuilder('openai_chat_completions', { model })
  let usage: ResponsesUsage | null = null
  let finishReason: unknown
  // Reasoning that resumes after visible output starts a new reasoning item.
  let reasoningSegment = 0
  const closeReasoning = () => builder.reasoningDone(`reasoning:${reasoningSegment++}`)
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
      const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content
        : typeof delta.reasoning === 'string' ? delta.reasoning : ''
      if (reasoning) yield* builder.reasoning(`reasoning:${reasoningSegment}`, reasoning)
      if (typeof delta.content === 'string' && delta.content) {
        if (builder.hasReasoning(`reasoning:${reasoningSegment}`)) yield* closeReasoning()
        yield* builder.text(delta.content)
      }
      if (typeof delta.refusal === 'string' && delta.refusal) yield* builder.refusal(delta.refusal)
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
  yield* builder.finish({ usage, incompleteReason: incompleteReason(finishReason) }).events
}

/** Open a Chat Completions stream, dropping optional parameters the provider rejects. */
export async function openChatCompletionsStream(
  client: OpenAI,
  payload: JsonRecord,
  options: { baseUrl: string; signal?: AbortSignal; headers?: Record<string, string> },
): Promise<AsyncIterable<ResponsesStreamEvent>> {
  let body = chatCompletionsRequest(payload, { baseUrl: options.baseUrl, stream: true })
  // Operator pass-through knobs degrade like the standard optional ones.
  const optional = new Set([...OPTIONAL_CHAT_PARAMETERS, ...Object.keys(passthroughParameters(payload))])
  for (let retries = 0; ; retries += 1) {
    try {
      const stream = await client.chat.completions.create(body as never, { signal: options.signal, headers: options.headers })
      return translateChatStream(stream as unknown as AsyncIterable<unknown>, String(payload.model))
    } catch (error) {
      if (retries >= MAX_PARAMETER_RETRIES) throw error
      const swapped = swappedTokenLimit(error, body)
      const parameter = swapped ? undefined : rejectedOptionalParameter(error, body, optional)
      if (!swapped && !parameter) throw error
      logParameterRetry('openai_chat_completions', parameter ?? 'max_tokens', error instanceof Error ? error.message : String(error))
      body = swapped ?? withoutKey(body, parameter!)
    }
  }
}
