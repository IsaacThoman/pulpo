import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ResponseEvent } from '@pulpo/contracts'
import type { responses } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { assertPublicIdentifier } from './identifiers.js'
import type { PublicGenerationRequest, StreamProjector } from './codecs.js'

type ResponseRow = typeof responses.$inferSelect
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function invalid(message: string, param?: string): never {
  throw new AppError(400, 'validation_error', message, 'invalid_request_error', param)
}

function unsupported(param: string, message = `Parameter ${param} is not supported`): never {
  throw new AppError(400, 'unsupported_parameter', message, 'invalid_request_error', param)
}

const anthropicTopLevelKeys = new Set([
  'model', 'messages', 'max_tokens', 'system', 'metadata', 'stop_sequences', 'stream', 'temperature',
  'top_p', 'top_k', 'tools', 'tool_choice', 'thinking', 'output_config', 'service_tier', 'container',
  'mcp_servers', 'context_management', 'inference_geo', 'speed', 'cache_control', 'output_format',
])

// Accepted for compatibility but without an equivalent in Pulpo's generation pipeline.
const ignoredAnthropicParameters = [
  'stop_sequences', 'top_k', 'service_tier', 'container', 'context_management', 'inference_geo', 'speed', 'cache_control',
]

const textBlockSchema = z.object({ type: z.literal('text'), text: z.string() }).passthrough()

const anthropicRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
  max_tokens: z.number().int().positive(),
  system: z.union([z.string(), z.array(textBlockSchema)]).nullish().transform((value) => value ?? undefined),
  metadata: z.object({ user_id: z.string().nullish() }).passthrough().nullish().transform((value) => value ?? undefined),
  stream: z.boolean().nullish().transform((value) => value ?? false),
  temperature: z.number().min(0).max(1).nullish().transform((value) => value ?? undefined),
  top_p: z.number().min(0).max(1).nullish().transform((value) => value ?? undefined),
  tools: z.array(z.unknown()).nullish().transform((value) => value ?? undefined),
  tool_choice: z.unknown().nullish().transform((value) => value ?? undefined),
  thinking: z.unknown().nullish().transform((value) => value ?? undefined),
  output_config: z.object({
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullish(),
    format: z.unknown().nullish(),
  }).passthrough().nullish().transform((value) => value ?? undefined),
  output_format: z.unknown().nullish().transform((value) => value ?? undefined),
}).passthrough()

function dataUrl(mediaType: string, data: string): string {
  return `data:${mediaType};base64,${data}`
}

function imageInput(block: JsonRecord, path: string): JsonRecord {
  const source = record(block.source)
  if (source?.type === 'base64' && typeof source.media_type === 'string' && typeof source.data === 'string') {
    return { type: 'input_image', image_url: dataUrl(source.media_type, source.data) }
  }
  if (source?.type === 'url' && typeof source.url === 'string') return { type: 'input_image', image_url: source.url }
  unsupported(`${path}.source.type`, 'Images must use base64 or url sources')
}

function documentInput(block: JsonRecord, path: string): JsonRecord {
  const source = record(block.source)
  const title = typeof block.title === 'string' ? block.title : undefined
  if (source?.type === 'base64' && source.media_type === 'application/pdf' && typeof source.data === 'string') {
    return { type: 'input_file', filename: title ?? 'document.pdf', file_data: dataUrl('application/pdf', source.data) }
  }
  if (source?.type === 'text' && typeof source.data === 'string') {
    return { type: 'input_text', text: title ? `${title}\n\n${source.data}` : source.data }
  }
  if (source?.type === 'content' && Array.isArray(source.content)) {
    const text = source.content.map((entry) => typeof entry === 'string' ? entry : record(entry)?.text).filter((value): value is string => typeof value === 'string').join('\n')
    return { type: 'input_text', text: title ? `${title}\n\n${text}` : text }
  }
  unsupported(`${path}.source.type`, 'Documents must use base64 PDF, text, or content sources')
}

function toolResultOutput(block: JsonRecord, path: string): string | JsonRecord[] {
  const prefix = block.is_error === true ? 'Error: ' : ''
  if (block.content === undefined || block.content === null) return prefix
  if (typeof block.content === 'string') return `${prefix}${block.content}`
  if (!Array.isArray(block.content)) invalid('tool_result content must be a string or array', `${path}.content`)
  const parts = block.content.map((raw, index): JsonRecord => {
    const part = record(raw)
    if (part?.type === 'text' && typeof part.text === 'string') return { type: 'input_text', text: part.text }
    if (part?.type === 'image') return imageInput(part, `${path}.content.${index}`)
    if (part?.type === 'document') return documentInput(part, `${path}.content.${index}`)
    unsupported(`${path}.content.${index}.type`, 'Tool results support text, image, and document content')
  })
  if (parts.every((part) => part.type === 'input_text')) return `${prefix}${parts.map((part) => part.text).join('\n')}`
  return prefix ? [{ type: 'input_text', text: prefix }, ...parts] : parts
}

/** Convert Anthropic messages into the Responses input items Pulpo stores and generates from. */
function anthropicInput(messages: unknown[]): unknown[] {
  const items: unknown[] = []
  for (const [index, rawMessage] of messages.entries()) {
    const message = record(rawMessage)
    const path = `messages.${index}`
    if (!message || typeof message.role !== 'string') invalid('Invalid message', path)
    const role = message.role
    if (role !== 'user' && role !== 'assistant' && role !== 'system') unsupported(`${path}.role`, `Message role ${role} is not supported`)
    if (typeof message.content === 'string') {
      items.push({ role: role === 'system' ? 'developer' : role, content: message.content })
      continue
    }
    if (!Array.isArray(message.content)) invalid('Message content must be a string or array', `${path}.content`)
    let parts: JsonRecord[] = []
    const flush = () => {
      if (!parts.length) return
      if (role === 'assistant') items.push({ role: 'assistant', content: parts.map((part) => part.text).join('') })
      else items.push({ role: role === 'system' ? 'developer' : 'user', content: parts })
      parts = []
    }
    for (const [blockIndex, rawBlock] of message.content.entries()) {
      const block = record(rawBlock)
      const blockPath = `${path}.content.${blockIndex}`
      if (!block || typeof block.type !== 'string') invalid('Invalid content block', blockPath)
      const type = block.type
      if (type === 'text') {
        if (typeof block.text !== 'string') invalid('Text blocks require text', `${blockPath}.text`)
        if (block.text) parts.push({ type: role === 'assistant' ? 'output_text' : 'input_text', text: block.text })
      } else if (role === 'assistant') {
        if (type === 'tool_use') {
          if (typeof block.id !== 'string' || typeof block.name !== 'string') invalid('tool_use blocks require id and name', blockPath)
          flush()
          items.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) })
        } else if (type === 'thinking' || type === 'redacted_thinking') {
          flush()
          items.push({
            type: 'reasoning', id: `rs_pulpo_in_${index}_${blockIndex}`,
            summary: typeof block.thinking === 'string' && block.thinking ? [{ type: 'summary_text', text: block.thinking }] : [],
            pulpo_format: 'anthropic_messages',
            ...(typeof block.signature === 'string' && block.signature ? { pulpo_signature: block.signature } : {}),
            ...(typeof block.data === 'string' ? { pulpo_redacted_data: block.data } : {}),
          })
        } else if (!type.endsWith('tool_result') && type !== 'server_tool_use' && type !== 'mcp_tool_use' && type !== 'container_upload') {
          unsupported(`${blockPath}.type`, `Assistant content type ${type} is not supported`)
        }
        // Results of Anthropic-hosted tools have no portable representation and are dropped.
      } else if (type === 'image') {
        parts.push(imageInput(block, blockPath))
      } else if (type === 'document') {
        parts.push(documentInput(block, blockPath))
      } else if (type === 'tool_result') {
        if (typeof block.tool_use_id !== 'string') invalid('tool_result blocks require tool_use_id', blockPath)
        flush()
        items.push({ type: 'function_call_output', call_id: block.tool_use_id, output: toolResultOutput(block, blockPath) })
      } else {
        unsupported(`${blockPath}.type`, `Content type ${type} is not supported`)
      }
    }
    flush()
  }
  return items
}

function anthropicTools(rawTools: unknown[] | undefined): unknown[] | undefined {
  if (!rawTools) return undefined
  return rawTools.map((rawTool, index) => {
    const tool = record(rawTool)
    const path = `tools.${index}`
    if (!tool) invalid('Invalid tool', path)
    if (tool.type !== undefined && tool.type !== null && tool.type !== 'custom') unsupported(`${path}.type`, 'Only custom tools are supported')
    if (typeof tool.name !== 'string') invalid('Tools require a name', `${path}.name`)
    return {
      type: 'function',
      name: tool.name,
      ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
      parameters: record(tool.input_schema) ?? { type: 'object', properties: {} },
      ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
    }
  })
}

function anthropicToolChoice(value: unknown): { toolChoice?: unknown; parallel?: boolean } {
  if (value === undefined) return {}
  const choice = record(value)
  if (!choice || typeof choice.type !== 'string') invalid('Invalid tool_choice', 'tool_choice')
  const parallel = choice.disable_parallel_tool_use === true ? false : undefined
  if (choice.type === 'auto') return { toolChoice: 'auto', parallel }
  if (choice.type === 'any') return { toolChoice: 'required', parallel }
  if (choice.type === 'none') return { toolChoice: 'none' }
  if (choice.type === 'tool') {
    if (typeof choice.name !== 'string') invalid('Tool choice requires a name', 'tool_choice.name')
    return { toolChoice: { type: 'function', name: choice.name }, parallel }
  }
  unsupported('tool_choice.type')
}

function budgetEffort(budget: unknown): string | undefined {
  if (typeof budget !== 'number') return undefined
  if (budget <= 2_048) return 'low'
  if (budget <= 12_000) return 'medium'
  return 'high'
}

function reasoningParameter(thinking: unknown, effort: string | null | undefined): JsonRecord | undefined {
  const config = record(thinking)
  if (thinking !== undefined && (!config || typeof config.type !== 'string')) invalid('Invalid thinking configuration', 'thinking')
  const enabled = config?.type === 'enabled' || config?.type === 'adaptive'
  const level = effort ?? (config?.type === 'enabled' ? budgetEffort(config.budget_tokens) : undefined)
  if (!enabled && !level) return undefined
  // `summary` marks that the client asked to see thinking blocks in the reply.
  return { ...(level ? { effort: level } : {}), ...(enabled ? { summary: 'auto' } : {}) }
}

function outputFormat(value: unknown): JsonRecord | undefined {
  const format = record(value)
  if (!format) return undefined
  if (format.type !== 'json_schema' || format.schema === undefined) unsupported('output_config.format.type', 'Only json_schema output formats are supported')
  return { format: { type: 'json_schema', name: 'response', schema: format.schema, strict: true } }
}

function safetyIdentifier(userId: string | null | undefined): string | undefined {
  if (!userId) return undefined
  // Responses limits the identifier to 64 characters; keep longer ids stable by hashing them.
  return userId.length <= 64 ? userId : createHash('sha256').update(userId).digest('hex')
}

export function parseAnthropicMessagesRequest(raw: unknown): PublicGenerationRequest {
  const source = record(raw)
  if (!source) invalid('Request body must be an object')
  const ignored = new Set(Object.keys(source).filter((key) => !anthropicTopLevelKeys.has(key)))
  for (const param of ignoredAnthropicParameters) if (Object.prototype.hasOwnProperty.call(source, param)) ignored.add(param)
  if (Array.isArray(source.mcp_servers) && source.mcp_servers.length) unsupported('mcp_servers', 'Remote MCP servers are not supported')
  const input = anthropicRequestSchema.parse(source)
  assertPublicIdentifier(input.model, 'model')
  const system = typeof input.system === 'string' ? input.system : input.system?.map((block) => block.text).join('\n\n')
  const tools = anthropicTools(input.tools)
  const choice = anthropicToolChoice(input.tool_choice)
  const text = outputFormat(input.output_config?.format ?? input.output_format)
  const parameters = Object.fromEntries(Object.entries({
    instructions: system || undefined,
    temperature: input.temperature,
    top_p: input.temperature === undefined ? input.top_p : undefined,
    reasoning: reasoningParameter(input.thinking, input.output_config?.effort),
    tools,
    tool_choice: tools?.length ? choice.toolChoice : undefined,
    parallel_tool_calls: tools?.length ? choice.parallel : undefined,
    text,
    safety_identifier: safetyIdentifier(input.metadata?.user_id),
  }).filter(([, value]) => value !== undefined))
  if (input.temperature !== undefined && input.top_p !== undefined) ignored.add('top_p')
  const rawInput = anthropicInput(input.messages)
  return {
    protocol: 'anthropic_messages',
    model: input.model,
    rawInput,
    displayInput: '[messages]',
    parameters,
    maxOutputTokens: input.max_tokens,
    stream: input.stream,
    background: false,
    publiclyStored: true,
    ignoredParameters: [...ignored].sort(),
    fingerprintValue: { model: input.model, input: rawInput, parameters, maxOutputTokens: input.max_tokens, stream: input.stream },
  }
}

function usageNumbers(value: unknown) {
  const usage = record(value) ?? {}
  const input = Number(usage.inputTokens ?? usage.input_tokens ?? 0)
  const cached = Number(usage.cachedInputTokens ?? record(usage.input_tokens_details)?.cached_tokens ?? 0)
  const cacheWrite = Number(usage.cacheWriteTokens ?? record(usage.input_tokens_details)?.cache_write_tokens ?? 0)
  const output = Number(usage.outputTokens ?? usage.output_tokens ?? 0)
  return { input, cached, cacheWrite, output }
}

/** Anthropic reports uncached input separately from cache reads and writes. */
export function anthropicUsageBody(value: unknown) {
  const usage = usageNumbers(value)
  return {
    input_tokens: Math.max(0, usage.input - usage.cached - usage.cacheWrite),
    cache_creation_input_tokens: usage.cacheWrite,
    cache_read_input_tokens: usage.cached,
    output_tokens: usage.output,
  }
}

function showsThinking(row: ResponseRow): boolean {
  return record(record(row.parameters)?.reasoning)?.summary !== undefined
}

function stopReason(row: Pick<ResponseRow, 'status' | 'incompleteDetails'>, hasToolUse: boolean): string {
  const reason = record(row.incompleteDetails)?.reason
  if (row.status === 'incomplete' && reason === 'max_output_tokens') return 'max_tokens'
  if (row.status === 'incomplete' && reason === 'content_filter') return 'refusal'
  return hasToolUse ? 'tool_use' : 'end_turn'
}

function parsedArguments(raw: unknown): JsonRecord {
  if (typeof raw !== 'string') return record(raw) ?? {}
  try {
    return record(JSON.parse(raw || '{}')) ?? {}
  } catch {
    return {}
  }
}

export function anthropicContent(output: unknown, includeThinking: boolean): JsonRecord[] {
  const items = Array.isArray(output) ? output.map(record).filter((item): item is JsonRecord => Boolean(item)) : []
  const content: JsonRecord[] = []
  for (const item of items) {
    if (item.type === 'reasoning' && includeThinking) {
      const text = Array.isArray(item.summary) ? item.summary.map((part) => record(part)?.text).filter((part): part is string => typeof part === 'string').join('\n') : ''
      if (typeof item.pulpo_redacted_data === 'string') content.push({ type: 'redacted_thinking', data: item.pulpo_redacted_data })
      else if (text || typeof item.pulpo_signature === 'string') content.push({ type: 'thinking', thinking: text, signature: typeof item.pulpo_signature === 'string' ? item.pulpo_signature : '' })
    } else if (item.type === 'message' && Array.isArray(item.content)) {
      const text = item.content.map((part) => {
        const value = record(part)
        if ((value?.type === 'output_text' || value?.type === 'text') && typeof value.text === 'string') return value.text
        if (value?.type === 'refusal' && typeof value.refusal === 'string') return value.refusal
        return ''
      }).join('')
      if (text) content.push({ type: 'text', text })
    } else if (item.type === 'function_call' && typeof item.name === 'string') {
      content.push({ type: 'tool_use', id: typeof item.call_id === 'string' ? item.call_id : String(item.id), name: item.name, input: parsedArguments(item.arguments) })
    }
  }
  return content
}

/** HTTP status and Anthropic error type for a failed generation. */
function anthropicFailure(row: ResponseRow): { status: number; type: string; message: string } {
  const error = record(row.error)
  const upstream = record(error?.upstream)
  const message = typeof error?.message === 'string' ? error.message : `Generation ${row.status}`
  if (typeof upstream?.status === 'number' && [400, 413, 422].includes(upstream.status)) {
    return { status: upstream.status, type: upstream.status === 413 ? 'request_too_large' : 'invalid_request_error', message }
  }
  return { status: 500, type: 'api_error', message }
}

export function serializeAnthropicMessage(row: ResponseRow) {
  if (row.status !== 'completed' && row.status !== 'incomplete') {
    const failure = anthropicFailure(row)
    throw new AppError(failure.status, 'generation_failed', failure.message, failure.type)
  }
  const content = anthropicContent(row.output, showsThinking(row))
  return {
    id: `msg_${row.id}`,
    type: 'message',
    role: 'assistant',
    model: row.modelId,
    content,
    stop_reason: stopReason(row, content.some((block) => block.type === 'tool_use')),
    stop_sequence: null,
    usage: anthropicUsageBody(row.usage),
  }
}

type BlockState = { index: number; open: boolean }

/**
 * Project Pulpo's Responses events onto the Anthropic Messages SSE protocol.
 * Text and thinking stream as deltas. Tool calls are emitted whole when each
 * call completes, because Responses providers may interleave the argument
 * deltas of parallel calls while Anthropic clients expect one block at a time.
 */
export class AnthropicStreamProjector implements StreamProjector {
  readonly sendsDoneSentinel = false
  private started = false
  private terminal = false
  private nextIndex = 0
  private sawToolUse = false
  private current: { key: string; block: BlockState } | undefined
  private readonly emittedTools = new Set<string>()
  private readonly thinking: boolean

  constructor(private readonly row: ResponseRow) {
    this.thinking = showsThinking(row)
  }

  encode(payload: unknown): string {
    const type = typeof record(payload)?.type === 'string' ? String(record(payload)!.type) : 'message'
    return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`
  }

  private start(output: unknown[]): void {
    if (this.started) return
    this.started = true
    output.push({
      type: 'message_start',
      message: {
        id: `msg_${this.row.id}`, type: 'message', role: 'assistant', model: this.row.modelId, content: [],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
      },
    })
  }

  private close(output: unknown[], extra?: unknown): void {
    if (!this.current) return
    if (extra) output.push(extra)
    output.push({ type: 'content_block_stop', index: this.current.block.index })
    this.current = undefined
  }

  /** The open block for `key`, starting a new one (and closing any other) when needed. */
  private open(key: string, contentBlock: JsonRecord, output: unknown[]): BlockState {
    if (this.current?.key === key) return this.current.block
    this.close(output)
    const block: BlockState = { index: this.nextIndex++, open: true }
    this.current = { key, block }
    output.push({ type: 'content_block_start', index: block.index, content_block: contentBlock })
    return block
  }

  private emitTool(item: JsonRecord, output: unknown[]): void {
    const id = typeof item.id === 'string' ? item.id : typeof item.call_id === 'string' ? item.call_id : ''
    if (!id || this.emittedTools.has(id) || typeof item.name !== 'string') return
    this.emittedTools.add(id)
    this.sawToolUse = true
    this.close(output)
    const index = this.nextIndex++
    const args = typeof item.arguments === 'string' && item.arguments.trim() ? item.arguments : '{}'
    output.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: typeof item.call_id === 'string' ? item.call_id : id, name: item.name, input: {} } })
    output.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: args } })
    output.push({ type: 'content_block_stop', index })
  }

  project(event: ResponseEvent): unknown[] {
    if (this.terminal) return []
    const payload = record(event.payload) ?? {}
    const output: unknown[] = []
    this.start(output)
    const itemId = typeof payload.item_id === 'string' ? payload.item_id : String(payload.output_index ?? 0)
    if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
      if (typeof payload.delta !== 'string' || !payload.delta) return output
      const block = this.open(`text:${itemId}`, { type: 'text', text: '' }, output)
      output.push({ type: 'content_block_delta', index: block.index, delta: { type: 'text_delta', text: payload.delta } })
    } else if (event.type === 'response.reasoning_summary_text.delta' && this.thinking) {
      if (typeof payload.delta !== 'string' || !payload.delta) return output
      const block = this.open(`thinking:${itemId}`, { type: 'thinking', thinking: '', signature: '' }, output)
      output.push({ type: 'content_block_delta', index: block.index, delta: { type: 'thinking_delta', thinking: payload.delta } })
    } else if (event.type === 'response.output_item.done') {
      const item = record(payload.item)
      const id = typeof item?.id === 'string' ? item.id : String(payload.output_index ?? 0)
      if (item?.type === 'function_call') this.emitTool(item, output)
      else if (item?.type === 'reasoning' && this.current?.key === `thinking:${id}`) {
        const signature = typeof item.pulpo_signature === 'string' && item.pulpo_signature
          ? { type: 'content_block_delta', index: this.current.block.index, delta: { type: 'signature_delta', signature: item.pulpo_signature } }
          : undefined
        this.close(output, signature)
      } else if (item?.type === 'reasoning' && this.thinking) {
        // Redacted or display-omitted thinking streams no text but must still reach clients for replay.
        const [block] = anthropicContent([item], true)
        if (block) {
          this.close(output)
          const index = this.nextIndex++
          if (block.type === 'redacted_thinking') output.push({ type: 'content_block_start', index, content_block: block })
          else {
            output.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } })
            if (block.thinking) output.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } })
            if (block.signature) output.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } })
          }
          output.push({ type: 'content_block_stop', index })
        }
      } else if (item?.type === 'message' && this.current?.key === `text:${id}`) this.close(output)
    } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      const response = record(payload.response) ?? {}
      output.push(...this.final({
        status: (typeof response.status === 'string' ? response.status : 'completed') as ResponseRow['status'],
        incompleteDetails: (record(response.incomplete_details) ?? null) as ResponseRow['incompleteDetails'],
      }, response.output, response.usage))
    }
    return output
  }

  private final(state: Pick<ResponseRow, 'status' | 'incompleteDetails'>, finalOutput: unknown, usage: unknown): unknown[] {
    if (this.terminal) return []
    this.terminal = true
    const output: unknown[] = []
    this.start(output)
    // Providers that never sent `output_item.done` for a call still report it in the final output.
    if (Array.isArray(finalOutput)) {
      for (const raw of finalOutput) {
        const item = record(raw)
        if (item?.type === 'function_call') this.emitTool(item, output)
      }
    }
    this.close(output)
    output.push({
      type: 'message_delta',
      delta: { stop_reason: stopReason(state, this.sawToolUse), stop_sequence: null },
      usage: anthropicUsageBody(usage),
    })
    output.push({ type: 'message_stop' })
    return output
  }

  finish(row: ResponseRow): unknown[] {
    if (this.terminal) return []
    if (row.status === 'failed' || row.status === 'cancelled') {
      this.terminal = true
      const failure = anthropicFailure(row)
      return [{ type: 'error', error: { type: failure.type, message: failure.message } }]
    }
    return this.final(row, row.output, row.usage)
  }
}

export function anthropicErrorType(status: number): string {
  if (status === 401) return 'authentication_error'
  if (status === 402) return 'billing_error'
  if (status === 403) return 'permission_error'
  if (status === 404) return 'not_found_error'
  if (status === 413) return 'request_too_large'
  if (status === 429) return 'rate_limit_error'
  if (status === 529) return 'overloaded_error'
  if (status >= 500) return 'api_error'
  return 'invalid_request_error'
}

/** Anthropic SDKs read `{type: "error", error: {type, message}}` bodies. */
export function anthropicErrorBody(status: number, message: string) {
  return { type: 'error', error: { type: anthropicErrorType(status), message } }
}

export function isAnthropicApiRequest(url: string): boolean {
  const path = url.split('?')[0] ?? ''
  return path === '/v1/messages' || path.startsWith('/v1/messages/')
}

const IMAGE_TOKEN_ESTIMATE = 1_600

/**
 * Approximate input tokens for `/v1/messages/count_tokens`. Pulpo serves many
 * tokenizers, so this is the same character heuristic used for budget
 * reservations, with inline media counted per item rather than per byte.
 */
export function estimateAnthropicInputTokens(request: PublicGenerationRequest): number {
  let media = 0
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip)
    const item = record(value)
    if (!item) return value
    if (item.type === 'input_image') {
      media += IMAGE_TOKEN_ESTIMATE
      return { type: 'input_image' }
    }
    if (item.type === 'input_file' && typeof item.file_data === 'string') {
      // Roughly one dense page per 3 KB of PDF, at about 1,500 tokens a page.
      media += Math.max(IMAGE_TOKEN_ESTIMATE, Math.ceil(item.file_data.length * 0.75 / 3_000) * 1_500)
      return { type: 'input_file' }
    }
    return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, strip(entry)]))
  }
  const text = JSON.stringify(strip({ input: request.rawInput, instructions: request.parameters.instructions, tools: request.parameters.tools }))
  return Math.max(1, Math.ceil(text.length / 4) + media)
}
