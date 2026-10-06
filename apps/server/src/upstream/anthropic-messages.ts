import type Anthropic from '@anthropic-ai/sdk'
import {
  functionTools,
  isTextMediaType,
  neutralConversation,
  neutralTextFormat,
  neutralToolChoice,
  parseDataUrl,
  passthroughParameters,
  reasoningEffort,
  type NeutralEntry,
  type NeutralPart,
} from './responses-input.js'
import { ResponsesStreamBuilder, responsesUsage, type ResponsesStreamEvent, type ResponsesUsage } from './responses-builder.js'
import { anthropicEffort, anthropicModelCapabilities, thinkingBudget } from './anthropic-models.js'
import { MAX_PARAMETER_RETRIES, logParameterRetry, rejectedOptionalParameter, withoutKey } from './parameter-retry.js'
import { upstreamErrorDetails } from '../responses/upstream-request.js'

type JsonRecord = Record<string, unknown>
type Block = JsonRecord & { type: string }
type AnthropicMessage = { role: 'user' | 'assistant'; content: Block[] }

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4_096

/** Anthropic SDK base URLs omit `/v1`; provider settings store the versioned base like OpenAI's. */
export function anthropicSdkBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
}

/** Tool-use ids must match `^[a-zA-Z0-9_-]+$`; apply the same mapping to calls and results. */
export function anthropicToolId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200)
  return sanitized || 'call'
}

function imageBlock(url: string): Block {
  const parsed = parseDataUrl(url)
  if (parsed) return { type: 'image', source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data } }
  return { type: 'image', source: { type: 'url', url } }
}

function fileBlock(part: Extract<NeutralPart, { type: 'file' }>): Block {
  const parsed = part.fileData ? parseDataUrl(part.fileData) : undefined
  const title = part.filename ? { title: part.filename } : {}
  if (parsed?.mediaType === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: parsed.data }, ...title }
  if (parsed && isTextMediaType(parsed.mediaType)) {
    return { type: 'document', source: { type: 'text', media_type: 'text/plain', data: Buffer.from(parsed.data, 'base64').toString('utf8') }, ...title }
  }
  const label = part.filename ?? part.fileId ?? 'attachment'
  return { type: 'text', text: `[Attachment ${label}${parsed ? ` (${parsed.mediaType})` : ''} cannot be read by this model]` }
}

function partBlocks(parts: NeutralPart[]): Block[] {
  return parts.flatMap((part): Block[] => {
    if (part.type === 'text') return part.text ? [{ type: 'text', text: part.text }] : []
    if (part.type === 'image') return [imageBlock(part.url)]
    return [fileBlock(part)]
  })
}

function toolInput(raw: string): JsonRecord {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown
    return record(parsed) ?? {}
  } catch {
    return {}
  }
}

/**
 * Build alternating user/assistant messages. Consecutive entries for one role
 * merge into one message so tool results sit directly after their tool use.
 */
export function anthropicMessagesFromEntries(
  entries: NeutralEntry[],
  options: { upstreamModel: string; replayThinking: boolean },
): AnthropicMessage[] {
  const messages: AnthropicMessage[] = []
  const append = (role: AnthropicMessage['role'], blocks: Block[]) => {
    if (!blocks.length) return
    const previous = messages.at(-1)
    if (previous?.role === role) previous.content.push(...blocks)
    else messages.push({ role, content: blocks })
  }
  for (const entry of entries) {
    if (entry.kind === 'system') continue
    if (entry.kind === 'user') append('user', partBlocks(entry.parts))
    else if (entry.kind === 'assistant') append('assistant', entry.text ? [{ type: 'text', text: entry.text }] : [])
    else if (entry.kind === 'function_call') {
      append('assistant', [{ type: 'tool_use', id: anthropicToolId(entry.callId), name: entry.name, input: toolInput(entry.arguments) }])
    } else if (entry.kind === 'function_output') {
      const content = partBlocks(entry.output).filter((block) => block.type === 'text' || block.type === 'image')
      append('user', [{ type: 'tool_result', tool_use_id: anthropicToolId(entry.callId), ...(content.length ? { content } : {}) }])
    } else if (options.replayThinking) {
      // Signed thinking only validates for the model that produced it.
      const reasoning = entry.reasoning
      const sameSource = reasoning.format === 'anthropic_messages' && (!reasoning.model || reasoning.model === options.upstreamModel)
      if (!sameSource) continue
      if (reasoning.redactedData) append('assistant', [{ type: 'redacted_thinking', data: reasoning.redactedData }])
      else if (reasoning.signature) append('assistant', [{ type: 'thinking', thinking: reasoning.text, signature: reasoning.signature }])
    }
  }
  // Tool results must lead their user message.
  for (const message of messages) {
    if (message.role !== 'user') continue
    const results = message.content.filter((block) => block.type === 'tool_result')
    if (results.length && results.length !== message.content.length) {
      message.content = [...results, ...message.content.filter((block) => block.type !== 'tool_result')]
    }
  }
  // Thinking blocks must precede the text and tool use of their assistant turn.
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const thinking = message.content.filter((block) => block.type === 'thinking' || block.type === 'redacted_thinking')
    if (thinking.length && thinking.length !== message.content.length) {
      message.content = [...thinking, ...message.content.filter((block) => block.type !== 'thinking' && block.type !== 'redacted_thinking')]
    } else if (thinking.length) {
      // A turn that is only thinking carries nothing the API accepts on its own.
      message.content = []
    }
  }
  const nonEmpty = messages.filter((message) => message.content.length > 0)
  const merged: AnthropicMessage[] = []
  for (const message of nonEmpty) {
    const previous = merged.at(-1)
    if (previous?.role === message.role) previous.content.push(...message.content)
    else merged.push(message)
  }
  if (merged[0]?.role !== 'user') merged.unshift({ role: 'user', content: [{ type: 'text', text: '(conversation continues)' }] })
  return merged
}

function stripThinkingBlocks(messages: AnthropicMessage[]): AnthropicMessage[] {
  return messages
    .map((message) => ({ ...message, content: message.content.filter((block) => block.type !== 'thinking' && block.type !== 'redacted_thinking') }))
    .filter((message) => message.content.length > 0)
}

function hasThinkingBlocks(messages: unknown): boolean {
  return Array.isArray(messages) && messages.some((message) => (record(message)?.content as Block[] | undefined)?.some?.((block) => block.type === 'thinking' || block.type === 'redacted_thinking'))
}

/** Translate a Responses API request body into an Anthropic Messages request body. */
export function anthropicMessagesRequest(payload: JsonRecord, options: { stream: boolean }): JsonRecord {
  const model = String(payload.model)
  const capabilities = anthropicModelCapabilities(model)
  const entries = neutralConversation(payload)
  const format = neutralTextFormat(payload.text)
  const systemTexts = entries.flatMap((entry) => entry.kind === 'system' ? [entry.text.trim()] : []).filter(Boolean)
  if (format?.type === 'json_object') systemTexts.push('Respond with a single valid JSON object and nothing else.')
  const maxTokens = typeof payload.max_output_tokens === 'number' && payload.max_output_tokens > 0
    ? payload.max_output_tokens
    : ANTHROPIC_DEFAULT_MAX_TOKENS
  const effort = reasoningEffort(payload.reasoning)
  const disableThinking = effort === 'none'
  let thinking: JsonRecord | undefined
  const outputConfig: JsonRecord = {}
  if (effort && capabilities.adaptiveThinking) {
    if (!disableThinking || capabilities.thinkingAlwaysOn) {
      thinking = { type: 'adaptive', display: 'summarized' }
      outputConfig.effort = anthropicEffort(effort, capabilities)
    } else {
      // Some adaptive models (Claude Opus 5) think when `thinking` is omitted.
      thinking = { type: 'disabled' }
    }
  } else if (effort && !disableThinking) {
    const budget = thinkingBudget(effort, maxTokens)
    if (budget) thinking = { type: 'enabled', budget_tokens: budget }
  }
  if (format?.type === 'json_schema') outputConfig.format = { type: 'json_schema', schema: format.schema }
  // Thinking rejects custom sampling; newer models reject it outright.
  const sampling = capabilities.sampling && (!thinking || thinking.type === 'disabled')
  const temperature = sampling && typeof payload.temperature === 'number' ? Math.min(1, Math.max(0, payload.temperature)) : undefined
  const topP = sampling && temperature === undefined && typeof payload.top_p === 'number' ? payload.top_p : undefined
  const tools = functionTools(payload.tools)
  const toolChoice = neutralToolChoice(payload.tool_choice)
  const disableParallel = payload.parallel_tool_calls === false
  // Forced tool use is rejected alongside thinking, and by models that always think.
  const canForceTools = !capabilities.thinkingAlwaysOn && (!thinking || thinking.type === 'disabled')
  let anthropicToolChoice: JsonRecord | undefined
  if (tools.length) {
    if (toolChoice === 'none') anthropicToolChoice = { type: 'none' }
    else if (toolChoice === 'required' && canForceTools) anthropicToolChoice = { type: 'any', ...(disableParallel ? { disable_parallel_tool_use: true } : {}) }
    else if (toolChoice && typeof toolChoice === 'object' && canForceTools) anthropicToolChoice = { type: 'tool', name: toolChoice.name, ...(disableParallel ? { disable_parallel_tool_use: true } : {}) }
    else if (disableParallel) anthropicToolChoice = { type: 'auto', disable_parallel_tool_use: true }
  }
  const messages = anthropicMessagesFromEntries(entries, { upstreamModel: model, replayThinking: true })
  return {
    model,
    max_tokens: maxTokens,
    ...(systemTexts.length ? { system: [{ type: 'text', text: systemTexts.join('\n\n') }] } : {}),
    messages,
    ...(thinking ? { thinking } : {}),
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(tools.length ? {
      tools: tools.map((tool) => {
        const schema = record(tool.parameters) ?? {}
        return {
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          input_schema: { ...schema, type: 'object' },
        }
      }),
    } : {}),
    ...(anthropicToolChoice ? { tool_choice: anthropicToolChoice } : {}),
    ...(record(payload.cache_control) ? { cache_control: payload.cache_control } : {}),
    ...(typeof payload.safety_identifier === 'string' ? { metadata: { user_id: payload.safety_identifier } } : {}),
    ...passthroughParameters(payload),
    stream: options.stream,
  }
}

export function anthropicUsage(raw: { input?: number; cacheRead?: number; cacheWrite?: number; output?: number }): ResponsesUsage {
  const cacheRead = raw.cacheRead ?? 0
  const cacheWrite = raw.cacheWrite ?? 0
  return responsesUsage({
    // Anthropic's input_tokens excludes cache reads and writes; Responses usage includes them.
    inputTokens: (raw.input ?? 0) + cacheRead + cacheWrite,
    cachedInputTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: raw.output ?? 0,
  })
}

function incompleteReason(stopReason: unknown): string | null {
  if (stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded') return 'max_output_tokens'
  if (stopReason === 'refusal') return 'content_filter'
  return null
}

function numberOr(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Translate Anthropic Messages stream events into Responses API events. */
export async function* translateAnthropicStream(events: AsyncIterable<unknown>, model: string): AsyncGenerator<ResponsesStreamEvent> {
  const builder = new ResponsesStreamBuilder('anthropic_messages', { model }, model)
  const blockKinds = new Map<number, string>()
  const usage: { input?: number; cacheRead?: number; cacheWrite?: number; output?: number } = {}
  let stopReason: unknown
  const readUsage = (value: unknown) => {
    const source = record(value)
    if (!source) return
    usage.input = numberOr(source.input_tokens, usage.input)
    usage.cacheRead = numberOr(source.cache_read_input_tokens, usage.cacheRead)
    usage.cacheWrite = numberOr(source.cache_creation_input_tokens, usage.cacheWrite)
    usage.output = numberOr(source.output_tokens, usage.output)
  }
  for await (const raw of events) {
    const event = record(raw)
    if (!event) continue
    if (event.type === 'message_start') {
      const message = record(event.message) ?? {}
      yield* builder.start({ id: typeof message.id === 'string' ? message.id : undefined, model: typeof message.model === 'string' ? message.model : undefined })
      readUsage(message.usage)
    } else if (event.type === 'content_block_start') {
      const index = Number(event.index)
      const block = record(event.content_block) ?? {}
      const kind = typeof block.type === 'string' ? block.type : 'unknown'
      blockKinds.set(index, kind)
      const key = `block:${index}`
      if (kind === 'text' && typeof block.text === 'string') yield* builder.text(block.text)
      else if (kind === 'thinking') {
        yield* builder.reasoningStart(key)
        if (typeof block.thinking === 'string') yield* builder.reasoning(key, block.thinking)
        if (typeof block.signature === 'string' && block.signature) builder.reasoningSignature(key, block.signature)
      } else if (kind === 'redacted_thinking' && typeof block.data === 'string') yield* builder.redactedReasoning(key, block.data)
      else if (kind === 'tool_use') {
        yield* builder.functionCall(key, { callId: typeof block.id === 'string' ? block.id : undefined, name: typeof block.name === 'string' ? block.name : undefined })
        const input = record(block.input)
        if (input && Object.keys(input).length) yield* builder.functionArguments(key, JSON.stringify(input))
      }
    } else if (event.type === 'content_block_delta') {
      const index = Number(event.index)
      const key = `block:${index}`
      const delta = record(event.delta) ?? {}
      if (delta.type === 'text_delta' && typeof delta.text === 'string') yield* builder.text(delta.text)
      else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') yield* builder.reasoning(key, delta.thinking)
      else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') builder.reasoningSignature(key, delta.signature)
      else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string' && blockKinds.get(index) === 'tool_use') yield* builder.functionArguments(key, delta.partial_json)
    } else if (event.type === 'content_block_stop') {
      const index = Number(event.index)
      const kind = blockKinds.get(index)
      if (kind === 'thinking' || kind === 'redacted_thinking') yield* builder.reasoningDone(`block:${index}`)
      else if (kind === 'tool_use') yield* builder.functionDone(`block:${index}`)
    } else if (event.type === 'message_delta') {
      const delta = record(event.delta) ?? {}
      if (delta.stop_reason) stopReason = delta.stop_reason
      readUsage(event.usage)
    } else if (event.type === 'error') {
      const error = record(event.error) ?? {}
      throw Object.assign(new Error(typeof error.message === 'string' ? error.message : 'Provider stream failed'), {
        type: typeof error.type === 'string' ? error.type : undefined,
        status: error.type === 'overloaded_error' ? 529 : error.type === 'rate_limit_error' ? 429 : undefined,
      })
    }
  }
  yield* builder.finish({ usage: anthropicUsage(usage), incompleteReason: incompleteReason(stopReason) }).events
}

const OPTIONAL_ANTHROPIC_PARAMETERS = new Set([
  'temperature', 'top_p', 'top_k', 'thinking', 'output_config', 'metadata', 'cache_control', 'tool_choice',
])

/** Whether a 400 is the preserved-thinking check rejecting a replayed signature. */
function thinkingSignatureRejected(error: unknown, body: JsonRecord): boolean {
  const details = upstreamErrorDetails(error)
  if (details.status !== 400) return false
  return hasThinkingBlocks(body.messages) && /signature/i.test(details.message)
}

/** Open an Anthropic Messages stream, degrading optional request features the provider rejects. */
export async function openAnthropicMessagesStream(
  client: Anthropic,
  payload: JsonRecord,
  options: { signal?: AbortSignal; headers?: Record<string, string> },
): Promise<AsyncIterable<ResponsesStreamEvent>> {
  let body = anthropicMessagesRequest(payload, { stream: true })
  // Operator pass-through knobs degrade like the standard optional ones.
  const optional = new Set([...OPTIONAL_ANTHROPIC_PARAMETERS, ...Object.keys(passthroughParameters(payload))])
  for (let retries = 0; ; retries += 1) {
    try {
      const stream = await client.messages.create(body as never, { signal: options.signal, headers: options.headers })
      return translateAnthropicStream(stream as unknown as AsyncIterable<unknown>, String(payload.model))
    } catch (error) {
      if (retries >= MAX_PARAMETER_RETRIES) throw error
      const message = error instanceof Error ? error.message : String(error)
      // Replayed thinking from an edited or compacted history no longer validates; drop it and retry.
      if (thinkingSignatureRejected(error, body)) {
        logParameterRetry('anthropic_messages', 'messages.thinking', message)
        body = Object.assign({}, body, { messages: stripThinkingBlocks(body.messages as AnthropicMessage[]) })
        continue
      }
      const parameter = rejectedOptionalParameter(error, body, optional)
      if (!parameter) throw error
      logParameterRetry('anthropic_messages', parameter, message)
      body = withoutKey(body, parameter)
    }
  }
}
