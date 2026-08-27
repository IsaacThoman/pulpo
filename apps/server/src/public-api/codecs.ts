import { z } from 'zod'
import type { ResponseEvent } from '@pulpo/contracts'
import { responses } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { sanitizeOutputForClient } from '../responses/public-output.js'

export type PublicApiProtocol = 'responses' | 'chat_completions' | 'completions'

export interface PublicGenerationRequest {
  protocol: PublicApiProtocol
  model: string
  rawInput: unknown
  displayInput: string
  parameters: Record<string, unknown>
  maxOutputTokens?: number
  stream: boolean
  background: boolean
  metadata?: Record<string, string>
  publiclyStored: boolean
  streamIncludeUsage?: boolean
  ignoredParameters: string[]
  fingerprintValue: unknown
}

type ResponseRow = typeof responses.$inferSelect
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function unsupported(param: string, message = `Parameter ${param} is not supported`): never {
  throw new AppError(400, 'unsupported_parameter', message, 'invalid_request_error', param)
}

function ignoredTopLevelParameters(value: JsonRecord, known: ReadonlySet<string>): Set<string> {
  return new Set(Object.keys(value).filter((candidate) => !known.has(candidate)))
}

function acceptNoop(
  value: JsonRecord,
  param: string,
  predicate: (candidate: unknown) => boolean,
  ignored: Set<string>,
): void {
  if (!Object.prototype.hasOwnProperty.call(value, param)) return
  if (!predicate(value[param])) unsupported(param)
  ignored.add(param)
}

const chatTopLevelKeys = new Set([
  'model', 'messages', 'stream', 'stream_options', 'max_completion_tokens', 'max_tokens',
  'temperature', 'top_p', 'reasoning_effort', 'service_tier', 'parallel_tool_calls',
  'tools', 'tool_choice', 'response_format', 'n', 'store',
  'audio', 'functions', 'function_call', 'logprobs', 'top_logprobs', 'stop',
  'presence_penalty', 'frequency_penalty', 'seed', 'prediction', 'modalities',
  'web_search_options',
])

const chatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
  stream: z.boolean().nullish().transform((value) => value ?? false),
  stream_options: z.object({ include_usage: z.boolean().optional() }).passthrough().nullish().transform((value) => value ?? undefined),
  max_completion_tokens: z.number().int().positive().nullish().transform((value) => value ?? undefined),
  max_tokens: z.number().int().positive().nullish().transform((value) => value ?? undefined),
  temperature: z.number().min(0).max(2).nullish().transform((value) => value ?? undefined),
  top_p: z.number().min(0).max(1).nullish().transform((value) => value ?? undefined),
  reasoning_effort: z.string().min(1).nullish().transform((value) => value ?? undefined),
  service_tier: z.string().min(1).nullish().transform((value) => value ?? undefined),
  parallel_tool_calls: z.boolean().nullish().transform((value) => value ?? undefined),
  tools: z.array(z.unknown()).nullish().transform((value) => value ?? undefined),
  tool_choice: z.unknown().nullish().transform((value) => value ?? undefined),
  response_format: z.unknown().nullish().transform((value) => value ?? undefined),
  n: z.number().int().positive().nullish().transform((value) => value ?? undefined),
  store: z.boolean().nullish().transform((value) => value ?? undefined),
}).passthrough()

function inputContent(content: unknown, path: string, images: boolean): unknown {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) throw new AppError(400, 'validation_error', 'Message content must be a string or array', 'invalid_request_error', path)
  return content.map((rawPart, index) => {
    const part = record(rawPart)
    if (!part || typeof part.type !== 'string') throw new AppError(400, 'validation_error', 'Invalid message content part', 'invalid_request_error', `${path}.${index}`)
    if (part.type === 'text') {
      if (typeof part.text !== 'string') throw new AppError(400, 'validation_error', 'Text content requires text', 'invalid_request_error', `${path}.${index}.text`)
      return { type: 'input_text', text: part.text }
    }
    if (part.type === 'image_url' && images) {
      const image = typeof part.image_url === 'string' ? { url: part.image_url } : record(part.image_url)
      if (!image || typeof image.url !== 'string') throw new AppError(400, 'validation_error', 'Image content requires a URL', 'invalid_request_error', `${path}.${index}.image_url`)
      return { type: 'input_image', image_url: image.url, ...(typeof image.detail === 'string' ? { detail: image.detail } : {}) }
    }
    unsupported(`${path}.${index}.type`, `Message content type ${part.type} is not supported`)
  })
}

function textOnlyContent(content: unknown, path: string): string {
  if (typeof content === 'string') return content
  const converted = inputContent(content, path, false)
  return (converted as Array<{ text: string }>).map((part) => part.text).join('')
}

function chatMessages(messages: unknown[]): unknown[] {
  const output: unknown[] = []
  for (const [index, rawMessage] of messages.entries()) {
    const message = record(rawMessage)
    const path = `messages.${index}`
    if (!message || typeof message.role !== 'string') throw new AppError(400, 'validation_error', 'Invalid chat message', 'invalid_request_error', path)
    if (message.role === 'developer' || message.role === 'system' || message.role === 'user') {
      output.push({ role: message.role, content: inputContent(message.content, `${path}.content`, message.role === 'user') })
      continue
    }
    if (message.role === 'assistant') {
      if (message.content !== undefined && message.content !== null) {
        const content = textOnlyContent(message.content, `${path}.content`)
        if (content) output.push({ role: 'assistant', content })
      }
      if (message.tool_calls !== undefined) {
        if (!Array.isArray(message.tool_calls)) throw new AppError(400, 'validation_error', 'tool_calls must be an array', 'invalid_request_error', `${path}.tool_calls`)
        for (const [toolIndex, rawToolCall] of message.tool_calls.entries()) {
          const toolCall = record(rawToolCall)
          const toolPath = `${path}.tool_calls.${toolIndex}`
          if (!toolCall) throw new AppError(400, 'validation_error', 'Invalid tool call', 'invalid_request_error', toolPath)
          if (toolCall.type !== 'function') unsupported(`${toolPath}.type`, 'Only function tool calls are supported')
          const fn = record(toolCall.function)
          if (typeof toolCall.id !== 'string' || !fn || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') {
            throw new AppError(400, 'validation_error', 'Invalid function tool call', 'invalid_request_error', toolPath)
          }
          output.push({ type: 'function_call', call_id: toolCall.id, name: fn.name, arguments: fn.arguments })
        }
      }
      if (message.content == null && !Array.isArray(message.tool_calls)) {
        throw new AppError(400, 'validation_error', 'Assistant message requires content or tool_calls', 'invalid_request_error', path)
      }
      continue
    }
    if (message.role === 'tool') {
      if (typeof message.tool_call_id !== 'string') {
        throw new AppError(400, 'validation_error', 'Tool messages require content and tool_call_id', 'invalid_request_error', path)
      }
      output.push({ type: 'function_call_output', call_id: message.tool_call_id, output: textOnlyContent(message.content, `${path}.content`) })
      continue
    }
    unsupported(`${path}.role`, `Message role ${message.role} is not supported`)
  }
  return output
}

function chatTools(rawTools: unknown[] | undefined): unknown[] | undefined {
  if (!rawTools) return undefined
  return rawTools.map((rawTool, index) => {
    const tool = record(rawTool)
    const path = `tools.${index}`
    if (!tool) throw new AppError(400, 'validation_error', 'Invalid tool', 'invalid_request_error', path)
    if (tool.type !== 'function') unsupported(`${path}.type`, 'Only function tools are supported')
    const fn = record(tool.function)
    if (!fn || typeof fn.name !== 'string') throw new AppError(400, 'validation_error', 'Function tool requires a name', 'invalid_request_error', `${path}.function`)
    return {
      type: 'function',
      name: fn.name,
      ...(typeof fn.description === 'string' ? { description: fn.description } : {}),
      ...(fn.parameters !== undefined ? { parameters: fn.parameters } : {}),
      ...(typeof fn.strict === 'boolean' ? { strict: fn.strict } : {}),
    }
  })
}

function chatToolChoice(value: unknown): unknown {
  if (value === undefined || typeof value === 'string') return value
  const choice = record(value)
  if (!choice) throw new AppError(400, 'validation_error', 'Invalid tool_choice', 'invalid_request_error', 'tool_choice')
  if (choice.type !== 'function') unsupported('tool_choice.type', 'Only function tool choices are supported')
  const fn = record(choice.function)
  if (!fn || typeof fn.name !== 'string') throw new AppError(400, 'validation_error', 'Function tool choice requires a name', 'invalid_request_error', 'tool_choice.function')
  return { type: 'function', name: fn.name }
}

function responsesTools(rawTools: unknown[] | undefined): unknown[] | undefined {
  if (!rawTools) return undefined
  return rawTools.map((rawTool, index) => {
    const tool = record(rawTool)
    const path = `tools.${index}`
    if (!tool) throw new AppError(400, 'validation_error', 'Invalid tool', 'invalid_request_error', path)
    if (tool.type !== 'function') unsupported(`${path}.type`, 'Only function tools are supported')
    if (typeof tool.name !== 'string') throw new AppError(400, 'validation_error', 'Function tool requires a name', 'invalid_request_error', `${path}.name`)
    return {
      type: 'function',
      name: tool.name,
      ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
      ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
      ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
    }
  })
}

function responsesToolChoice(value: unknown): unknown {
  if (value === undefined || typeof value === 'string') return value
  const choice = record(value)
  if (!choice) throw new AppError(400, 'validation_error', 'Invalid tool_choice', 'invalid_request_error', 'tool_choice')
  if (choice.type !== 'function') unsupported('tool_choice.type', 'Only function tool choices are supported')
  if (typeof choice.name !== 'string') throw new AppError(400, 'validation_error', 'Function tool choice requires a name', 'invalid_request_error', 'tool_choice.name')
  return { type: 'function', name: choice.name }
}

function rejectDeferredResponseParts(input: unknown): void {
  if (!Array.isArray(input)) return
  for (const [itemIndex, rawItem] of input.entries()) {
    const item = record(rawItem)
    if (!item || !Array.isArray(item.content)) continue
    for (const [partIndex, rawPart] of item.content.entries()) {
      const type = record(rawPart)?.type
      if (type === 'input_audio' || type === 'audio' || type === 'input_file' || type === 'file') {
        unsupported(`input.${itemIndex}.content.${partIndex}.type`, `Input content type ${type} is not supported`)
      }
    }
  }
}

function responseTextFormat(value: unknown): unknown {
  if (value === undefined) return undefined
  const format = record(value)
  if (!format || typeof format.type !== 'string') throw new AppError(400, 'validation_error', 'Invalid response_format', 'invalid_request_error', 'response_format')
  if (format.type === 'text' || format.type === 'json_object') {
    return { format: { type: format.type } }
  }
  if (format.type !== 'json_schema') unsupported('response_format.type')
  const schema = record(format.json_schema)
  if (!schema || typeof schema.name !== 'string' || schema.schema === undefined) {
    throw new AppError(400, 'validation_error', 'json_schema requires name and schema', 'invalid_request_error', 'response_format.json_schema')
  }
  return { format: {
    type: 'json_schema', name: schema.name, schema: schema.schema,
    ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
    ...(typeof schema.strict === 'boolean' ? { strict: schema.strict } : {}),
  } }
}

export function parseChatCompletionRequest(raw: unknown): PublicGenerationRequest {
  const source = record(raw)
  if (!source) throw new AppError(400, 'validation_error', 'Request body must be an object', 'invalid_request_error')
  const ignored = ignoredTopLevelParameters(source, chatTopLevelKeys)
  acceptNoop(source, 'audio', (value) => value == null, ignored)
  acceptNoop(source, 'functions', (value) => value == null || (Array.isArray(value) && value.length === 0), ignored)
  acceptNoop(source, 'function_call', (value) => value == null, ignored)
  acceptNoop(source, 'logprobs', (value) => value == null || value === false, ignored)
  acceptNoop(source, 'top_logprobs', (value) => value == null || value === 0, ignored)
  acceptNoop(source, 'stop', (value) => value == null || (Array.isArray(value) && value.length === 0), ignored)
  acceptNoop(source, 'presence_penalty', (value) => value == null || value === 0, ignored)
  acceptNoop(source, 'frequency_penalty', (value) => value == null || value === 0, ignored)
  acceptNoop(source, 'seed', (value) => value == null, ignored)
  acceptNoop(source, 'prediction', (value) => value == null, ignored)
  acceptNoop(source, 'modalities', (value) => value == null || (Array.isArray(value) && value.length === 1 && value[0] === 'text'), ignored)
  acceptNoop(source, 'web_search_options', (value) => value == null, ignored)
  const input = chatRequestSchema.parse(source)
  if (input.max_completion_tokens !== undefined && input.max_tokens !== undefined) {
    throw new AppError(400, 'parameter_conflict', 'Specify only one of max_completion_tokens or max_tokens', 'invalid_request_error', 'max_completion_tokens')
  }
  if (input.n !== undefined && input.n !== 1) unsupported('n', 'Only n=1 is supported')
  if (input.store === true) unsupported('store', 'Stored Chat Completions are not supported')
  if (input.stream_options && !input.stream) throw new AppError(400, 'parameter_conflict', 'stream_options requires stream=true', 'invalid_request_error', 'stream_options')
  const tools = chatTools(input.tools)
  const text = responseTextFormat(input.response_format)
  const parameters = Object.fromEntries(Object.entries({
    temperature: input.temperature,
    top_p: input.top_p,
    reasoning: input.reasoning_effort ? { effort: input.reasoning_effort } : undefined,
    service_tier: input.service_tier,
    parallel_tool_calls: input.parallel_tool_calls,
    tools,
    tool_choice: chatToolChoice(input.tool_choice),
    text,
  }).filter(([, value]) => value !== undefined))
  const rawInput = chatMessages(input.messages)
  return {
    protocol: 'chat_completions',
    model: input.model,
    rawInput,
    displayInput: '[chat messages]',
    parameters,
    maxOutputTokens: input.max_completion_tokens ?? input.max_tokens,
    stream: input.stream,
    background: false,
    publiclyStored: true,
    streamIncludeUsage: input.stream_options?.include_usage ?? false,
    ignoredParameters: [...ignored].sort(),
    fingerprintValue: {
      model: input.model, input: rawInput, parameters,
      maxOutputTokens: input.max_completion_tokens ?? input.max_tokens,
      stream: input.stream, streamIncludeUsage: input.stream_options?.include_usage ?? false,
    },
  }
}

const completionTopLevelKeys = new Set([
  'model', 'prompt', 'stream', 'max_tokens', 'temperature', 'top_p', 'n',
  'best_of', 'echo', 'suffix', 'logprobs', 'stop', 'presence_penalty', 'frequency_penalty', 'seed',
])
const completionRequestSchema = z.object({
  model: z.string().min(1),
  prompt: z.string(),
  stream: z.boolean().nullish().transform((value) => value ?? false),
  max_tokens: z.number().int().positive().nullish().transform((value) => value ?? undefined),
  temperature: z.number().min(0).max(2).nullish().transform((value) => value ?? undefined),
  top_p: z.number().min(0).max(1).nullish().transform((value) => value ?? undefined),
  n: z.number().int().positive().nullish().transform((value) => value ?? undefined),
}).passthrough()

export function parseCompletionRequest(raw: unknown): PublicGenerationRequest {
  const source = record(raw)
  if (!source) throw new AppError(400, 'validation_error', 'Request body must be an object', 'invalid_request_error')
  const ignored = ignoredTopLevelParameters(source, completionTopLevelKeys)
  acceptNoop(source, 'best_of', (value) => value == null || value === 1, ignored)
  acceptNoop(source, 'echo', (value) => value == null || value === false, ignored)
  acceptNoop(source, 'suffix', (value) => value == null || value === '', ignored)
  acceptNoop(source, 'logprobs', (value) => value == null, ignored)
  acceptNoop(source, 'stop', (value) => value == null || (Array.isArray(value) && value.length === 0), ignored)
  acceptNoop(source, 'presence_penalty', (value) => value == null || value === 0, ignored)
  acceptNoop(source, 'frequency_penalty', (value) => value == null || value === 0, ignored)
  acceptNoop(source, 'seed', (value) => value == null, ignored)
  if (Array.isArray(source.prompt)) unsupported('prompt', 'Prompt arrays and token arrays are not supported')
  const input = completionRequestSchema.parse(source)
  if (input.n !== undefined && input.n !== 1) unsupported('n', 'Only n=1 is supported')
  return {
    protocol: 'completions', model: input.model, rawInput: input.prompt, displayInput: input.prompt,
    parameters: Object.fromEntries(Object.entries({ temperature: input.temperature, top_p: input.top_p }).filter(([, value]) => value !== undefined)),
    maxOutputTokens: input.max_tokens, stream: input.stream, background: false, publiclyStored: true,
    ignoredParameters: [...ignored].sort(),
    fingerprintValue: {
      model: input.model, input: input.prompt,
      parameters: Object.fromEntries(Object.entries({ temperature: input.temperature, top_p: input.top_p }).filter(([, value]) => value !== undefined)),
      maxOutputTokens: input.max_tokens, stream: input.stream,
    },
  }
}

const responsesTopLevelKeys = new Set([
  'model', 'input', 'stream', 'background', 'max_output_tokens', 'metadata', 'instructions',
  'temperature', 'top_p', 'tools', 'tool_choice', 'parallel_tool_calls', 'reasoning', 'text',
  'store', 'service_tier', 'context_management', 'conversation', 'include', 'max_tool_calls',
  'moderation', 'previous_response_id', 'prompt', 'prompt_cache_key', 'prompt_cache_options',
  'prompt_cache_retention', 'safety_identifier', 'stream_options', 'top_logprobs', 'truncation', 'user',
])

const supportedResponseIncludes = new Set([
  'message.output_text.logprobs',
  'reasoning.encrypted_content',
])

function responseIncludes(source: JsonRecord, ignored: Set<string>): string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, 'include')) return undefined
  const value = source.include
  if (value == null || (Array.isArray(value) && value.length === 0)) {
    ignored.add('include')
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new AppError(400, 'validation_error', 'include must be an array', 'invalid_request_error', 'include')
  }
  const normalized = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== 'string' || !supportedResponseIncludes.has(candidate)) {
      unsupported('include', `Include value ${String(candidate)} is not supported`)
    }
    normalized.add(candidate)
  }
  return [...normalized].sort()
}

const promptCacheOptionsSchema = z.object({
  mode: z.enum(['implicit', 'explicit']).optional(),
  ttl: z.literal('30m').optional(),
})

const responseStreamOptionsSchema = z.object({
  include_obfuscation: z.boolean().optional(),
})

const responsesRequestSchema = z.object({
  model: z.string().min(1),
  input: z.union([z.string(), z.array(z.unknown())]),
  stream: z.boolean().nullish().transform((value) => value ?? false),
  background: z.boolean().nullish().transform((value) => value ?? false),
  max_output_tokens: z.number().int().positive().nullish().transform((value) => value ?? undefined),
  metadata: z.record(z.string(), z.string()).nullish().transform((value) => value ?? undefined),
  instructions: z.string().nullish().transform((value) => value ?? undefined),
  temperature: z.number().min(0).max(2).nullish().transform((value) => value ?? undefined),
  top_p: z.number().min(0).max(1).nullish().transform((value) => value ?? undefined),
  tools: z.array(z.unknown()).nullish().transform((value) => value ?? undefined),
  tool_choice: z.unknown().nullish().transform((value) => value ?? undefined),
  parallel_tool_calls: z.boolean().nullish().transform((value) => value ?? undefined),
  reasoning: z.unknown().nullish().transform((value) => value ?? undefined),
  text: z.unknown().nullish().transform((value) => value ?? undefined),
  store: z.boolean().nullish().transform((value) => value ?? true),
  service_tier: z.string().min(1).nullish().transform((value) => value ?? undefined),
  prompt_cache_key: z.string().min(1).nullish().transform((value) => value ?? undefined),
  prompt_cache_options: promptCacheOptionsSchema.nullish().transform((value) => value ?? undefined),
  prompt_cache_retention: z.enum(['in_memory', '24h']).nullish().transform((value) => value ?? undefined),
  safety_identifier: z.string().min(1).max(64).nullish().transform((value) => value ?? undefined),
  stream_options: responseStreamOptionsSchema.nullish().transform((value) => value ?? undefined),
  top_logprobs: z.number().int().min(0).max(20).nullish().transform((value) => value ?? undefined),
  truncation: z.enum(['auto', 'disabled']).nullish().transform((value) => value ?? undefined),
  user: z.string().min(1).nullish().transform((value) => value ?? undefined),
}).passthrough()

export function parseResponsesRequest(raw: unknown): PublicGenerationRequest {
  const source = record(raw)
  if (!source) throw new AppError(400, 'validation_error', 'Request body must be an object', 'invalid_request_error')
  const ignored = ignoredTopLevelParameters(source, responsesTopLevelKeys)
  acceptNoop(source, 'context_management', (value) => value == null || (Array.isArray(value) && value.length === 0), ignored)
  acceptNoop(source, 'conversation', (value) => value == null, ignored)
  const include = responseIncludes(source, ignored)
  acceptNoop(source, 'max_tool_calls', (value) => value == null, ignored)
  acceptNoop(source, 'moderation', (value) => value == null, ignored)
  acceptNoop(source, 'previous_response_id', (value) => value == null, ignored)
  acceptNoop(source, 'prompt', (value) => value == null, ignored)
  const input = responsesRequestSchema.parse(source)
  if (input.stream && input.background) throw new AppError(400, 'parameter_conflict', 'Streaming background responses are not supported', 'invalid_request_error', 'background')
  rejectDeferredResponseParts(input.input)
  const tools = responsesTools(input.tools)
  const toolChoice = responsesToolChoice(input.tool_choice)
  const promptCacheOptions = input.prompt_cache_options && Object.keys(input.prompt_cache_options).length
    ? input.prompt_cache_options
    : undefined
  if (input.prompt_cache_options && !promptCacheOptions) ignored.add('prompt_cache_options')
  let streamOptions = input.stream_options?.include_obfuscation === undefined
    ? undefined
    : { include_obfuscation: input.stream_options.include_obfuscation }
  if (streamOptions && !input.stream) {
    if (streamOptions.include_obfuscation) throw new AppError(400, 'parameter_conflict', 'stream_options requires stream=true', 'invalid_request_error', 'stream_options')
    streamOptions = undefined
  }
  if (input.stream_options && !streamOptions) ignored.add('stream_options')
  const promptCacheKey = input.prompt_cache_key ?? input.user
  const safetyIdentifier = input.safety_identifier ?? input.user
  if (input.user && input.prompt_cache_key && input.safety_identifier) ignored.add('user')
  const parameters = Object.fromEntries(Object.entries({
    instructions: input.instructions, temperature: input.temperature, top_p: input.top_p,
    tools, tool_choice: toolChoice, parallel_tool_calls: input.parallel_tool_calls,
    reasoning: input.reasoning, text: input.text, service_tier: input.service_tier,
    include, prompt_cache_key: promptCacheKey, prompt_cache_options: promptCacheOptions,
    prompt_cache_retention: input.prompt_cache_retention, safety_identifier: safetyIdentifier,
    stream_options: streamOptions, top_logprobs: input.top_logprobs,
    truncation: input.truncation === 'auto' ? input.truncation : undefined,
  }).filter(([, value]) => value !== undefined))
  if (input.truncation === 'disabled') ignored.add('truncation')
  return {
    protocol: 'responses', model: input.model, rawInput: input.input,
    displayInput: typeof input.input === 'string' ? input.input : '[structured input]',
    parameters,
    maxOutputTokens: input.max_output_tokens, stream: input.stream, background: input.background,
    metadata: input.metadata,
    publiclyStored: input.store,
    ignoredParameters: [...ignored].sort(),
    fingerprintValue: {
      model: input.model, input: input.input,
      parameters,
      maxOutputTokens: input.max_output_tokens, stream: input.stream, background: input.background,
      metadata: input.metadata, store: input.store,
    },
  }
}

function usageValues(value: unknown) {
  const usage = record(value) ?? {}
  const inputDetails = record(usage.input_tokens_details) ?? {}
  const outputDetails = record(usage.output_tokens_details) ?? {}
  const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0)
  const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0)
  return {
    inputTokens,
    cachedInputTokens: Number(inputDetails.cached_tokens ?? usage.cachedInputTokens ?? 0),
    cacheWriteTokens: Number(inputDetails.cache_write_tokens ?? usage.cacheWriteTokens ?? 0),
    outputTokens,
    reasoningTokens: Number(outputDetails.reasoning_tokens ?? usage.reasoningTokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens),
  }
}

function responseUsage(value: unknown) {
  const usage = usageValues(value)
  return {
    input_tokens: usage.inputTokens,
    input_tokens_details: { cached_tokens: usage.cachedInputTokens, cache_write_tokens: usage.cacheWriteTokens },
    output_tokens: usage.outputTokens,
    output_tokens_details: { reasoning_tokens: usage.reasoningTokens },
    total_tokens: usage.totalTokens,
  }
}

function completionUsage(value: unknown) {
  const usage = usageValues(value)
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    prompt_tokens_details: { cached_tokens: usage.cachedInputTokens, cache_write_tokens: usage.cacheWriteTokens },
    completion_tokens_details: { reasoning_tokens: usage.reasoningTokens },
  }
}

function outputMessage(output: unknown) {
  const items = Array.isArray(output) ? output.map(record).filter((item): item is JsonRecord => Boolean(item)) : []
  let content = ''
  let refusal: string | null = null
  const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []
  for (const item of items) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const rawPart of item.content) {
        const part = record(rawPart)
        if (!part) continue
        if ((part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') content += part.text
        if (part.type === 'refusal' && typeof part.refusal === 'string') refusal = `${refusal ?? ''}${part.refusal}`
      }
    }
    if (item.type === 'function_call' && typeof item.name === 'string' && typeof item.arguments === 'string') {
      toolCalls.push({
        id: typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : `call_${toolCalls.length}`,
        type: 'function',
        function: { name: item.name, arguments: item.arguments },
      })
    }
  }
  return { content: content || null, refusal, toolCalls }
}

function finishReason(status: ResponseRow['status'], incompleteDetails: unknown, hasTools: boolean): 'stop' | 'length' | 'tool_calls' {
  if (status === 'incomplete' && record(incompleteDetails)?.reason === 'max_output_tokens') return 'length'
  return hasTools ? 'tool_calls' : 'stop'
}

function assertCompletionSucceeded(row: ResponseRow): void {
  if (row.status === 'completed' || row.status === 'incomplete') return
  const error = record(row.error)
  throw new AppError(500, 'generation_failed', typeof error?.message === 'string' ? error.message : `Generation ${row.status}`, 'server_error')
}

function streamError(row: ResponseRow): { error: { message: string; type: 'server_error'; code: unknown; param: null } } {
  const error = record(row.error)
  return { error: {
    message: typeof error?.message === 'string' ? error.message : `Generation ${row.status}`,
    type: 'server_error',
    code: error?.code ?? 'generation_failed',
    param: null,
  } }
}

export function serializePublicResponse(row: ResponseRow) {
  return {
    id: row.id,
    object: 'response',
    created_at: Math.floor(row.createdAt.getTime() / 1_000),
    status: row.status,
    model: row.modelId,
    output: sanitizeOutputForClient(row.output as unknown[]),
    error: row.error,
    incomplete_details: row.incompleteDetails,
    usage: row.usage ? responseUsage(row.usage) : null,
    metadata: row.metadata,
    store: row.publiclyStored,
  }
}

export function serializeChatCompletion(row: ResponseRow) {
  assertCompletionSucceeded(row)
  const message = outputMessage(row.output)
  return {
    id: `chatcmpl-${row.id}`,
    object: 'chat.completion',
    created: Math.floor(row.createdAt.getTime() / 1_000),
    model: row.modelId,
    ...(typeof record(row.parameters)?.service_tier === 'string' ? { service_tier: record(row.parameters)!.service_tier } : {}),
    choices: [{
      index: 0,
      message: {
        role: 'assistant', content: message.content, refusal: message.refusal,
        ...(message.toolCalls.length ? { tool_calls: message.toolCalls } : {}),
      },
      finish_reason: finishReason(row.status, row.incompleteDetails, message.toolCalls.length > 0),
      logprobs: null,
    }],
    usage: completionUsage(row.usage),
  }
}

export function serializeCompletion(row: ResponseRow) {
  assertCompletionSucceeded(row)
  const message = outputMessage(row.output)
  return {
    id: `cmpl-${row.id}`,
    object: 'text_completion',
    created: Math.floor(row.createdAt.getTime() / 1_000),
    model: row.modelId,
    choices: [{ index: 0, text: message.content ?? '', finish_reason: finishReason(row.status, row.incompleteDetails, false), logprobs: null }],
    usage: completionUsage(row.usage),
  }
}

export interface StreamProjector {
  project(event: ResponseEvent): unknown[]
  finish(row: ResponseRow): unknown[]
}

export class ResponsesStreamProjector implements StreamProjector {
  private terminal = false

  constructor(private readonly row: ResponseRow) {}

  project(event: ResponseEvent): unknown[] {
    if (event.type === 'response.failed' || event.type === 'response.cancelled') return []
    if (event.type === 'response.completed' || event.type === 'response.incomplete') this.terminal = true
    const payload = record(event.payload)
    const response = record(payload?.response)
    if (!payload || !response) return [event.payload]
    return [{
      ...payload,
      response: {
        ...response,
        id: this.row.id,
        model: this.row.modelId,
        metadata: this.row.metadata,
        store: this.row.publiclyStored,
        ...(Array.isArray(response.output) ? { output: sanitizeOutputForClient(response.output) } : {}),
      },
    }]
  }

  finish(row: ResponseRow): unknown[] {
    if (this.terminal) return []
    this.terminal = true
    const suffix = row.status === 'cancelled' ? 'failed' : row.status
    return [{ type: `response.${suffix}`, response: serializePublicResponse(row) }]
  }
}

abstract class CompletionStreamProjector implements StreamProjector {
  protected terminal = false
  protected readonly created: number
  protected readonly model: string

  constructor(protected readonly row: ResponseRow) {
    this.created = Math.floor(row.createdAt.getTime() / 1_000)
    this.model = row.modelId
  }

  abstract project(event: ResponseEvent): unknown[]
  abstract finish(row: ResponseRow): unknown[]

  protected terminalState(payload: unknown): { status: ResponseRow['status']; incompleteDetails: unknown; usage: unknown } {
    const response = record(record(payload)?.response) ?? {}
    return {
      status: (typeof response.status === 'string' ? response.status : 'completed') as ResponseRow['status'],
      incompleteDetails: response.incomplete_details,
      usage: response.usage,
    }
  }
}

export class ChatCompletionStreamProjector extends CompletionStreamProjector {
  private roleSent = false
  private sawToolCall = false
  private readonly toolIndexes = new Map<string, number>()

  constructor(row: ResponseRow, private readonly includeUsage: boolean) { super(row) }

  private chunk(delta: JsonRecord, finish_reason: string | null = null, usage: unknown = null) {
    return {
      id: `chatcmpl-${this.row.id}`, object: 'chat.completion.chunk', created: this.created, model: this.model,
      choices: [{ index: 0, delta, finish_reason, logprobs: null }],
      ...(typeof record(this.row.parameters)?.service_tier === 'string' ? { service_tier: record(this.row.parameters)!.service_tier } : {}),
      ...(this.includeUsage ? { usage: usage ? completionUsage(usage) : null } : {}),
    }
  }

  private ensureRole(output: unknown[]): void {
    if (this.roleSent) return
    this.roleSent = true
    output.push(this.chunk({ role: 'assistant', content: '' }))
  }

  private final(status: ResponseRow['status'], incompleteDetails: unknown, usage: unknown): unknown[] {
    if (this.terminal) return []
    this.terminal = true
    const output: unknown[] = []
    this.ensureRole(output)
    output.push(this.chunk({}, finishReason(status, incompleteDetails, this.sawToolCall)))
    if (this.includeUsage) output.push({
      id: `chatcmpl-${this.row.id}`, object: 'chat.completion.chunk', created: this.created, model: this.model,
      choices: [],
      ...(typeof record(this.row.parameters)?.service_tier === 'string' ? { service_tier: record(this.row.parameters)!.service_tier } : {}),
      usage: completionUsage(usage),
    })
    return output
  }

  project(event: ResponseEvent): unknown[] {
    const payload = record(event.payload) ?? {}
    const output: unknown[] = []
    if (event.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
      this.ensureRole(output)
      output.push(this.chunk({ content: payload.delta }))
    } else if (event.type === 'response.output_item.added') {
      const item = record(payload.item)
      if (item?.type === 'function_call' && typeof item.name === 'string') {
        this.ensureRole(output)
        this.sawToolCall = true
        const key = typeof item.id === 'string' ? item.id : typeof item.call_id === 'string' ? item.call_id : String(payload.output_index ?? this.toolIndexes.size)
        const index = this.toolIndexes.size
        this.toolIndexes.set(key, index)
        output.push(this.chunk({ tool_calls: [{
          index,
          id: typeof item.call_id === 'string' ? item.call_id : key,
          type: 'function',
          function: { name: item.name, arguments: '' },
        }] }))
      }
    } else if (event.type === 'response.function_call_arguments.delta' && typeof payload.delta === 'string') {
      this.ensureRole(output)
      this.sawToolCall = true
      const key = typeof payload.item_id === 'string' ? payload.item_id : String(payload.output_index ?? 0)
      const index = this.toolIndexes.get(key) ?? Number(payload.output_index ?? 0)
      output.push(this.chunk({ tool_calls: [{ index, function: { arguments: payload.delta } }] }))
    } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      const state = this.terminalState(payload)
      output.push(...this.final(state.status, state.incompleteDetails, state.usage))
    }
    return output
  }

  finish(row: ResponseRow): unknown[] {
    if (row.status === 'failed' || row.status === 'cancelled') {
      if (this.terminal) return []
      this.terminal = true
      return [streamError(row)]
    }
    return this.final(row.status, row.incompleteDetails, row.usage)
  }
}

export class LegacyCompletionStreamProjector extends CompletionStreamProjector {
  private chunk(text: string, finish_reason: string | null = null) {
    return {
      id: `cmpl-${this.row.id}`, object: 'text_completion', created: this.created, model: this.model,
      choices: [{ index: 0, text, finish_reason, logprobs: null }],
    }
  }

  private final(status: ResponseRow['status'], incompleteDetails: unknown): unknown[] {
    if (this.terminal) return []
    this.terminal = true
    return [this.chunk('', finishReason(status, incompleteDetails, false))]
  }

  project(event: ResponseEvent): unknown[] {
    const payload = record(event.payload) ?? {}
    if (event.type === 'response.output_text.delta' && typeof payload.delta === 'string') return [this.chunk(payload.delta)]
    if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      const state = this.terminalState(payload)
      return this.final(state.status, state.incompleteDetails)
    }
    return []
  }

  finish(row: ResponseRow): unknown[] {
    if (row.status === 'failed' || row.status === 'cancelled') {
      if (this.terminal) return []
      this.terminal = true
      return [streamError(row)]
    }
    return this.final(row.status, row.incompleteDetails)
  }
}

export function streamProjector(protocol: PublicApiProtocol, row: ResponseRow, includeUsage = false): StreamProjector {
  if (protocol === 'chat_completions') return new ChatCompletionStreamProjector(row, includeUsage)
  if (protocol === 'completions') return new LegacyCompletionStreamProjector(row)
  return new ResponsesStreamProjector(row)
}

export function serializeProtocolResponse(protocol: PublicApiProtocol, row: ResponseRow) {
  if (protocol === 'chat_completions') return serializeChatCompletion(row)
  if (protocol === 'completions') return serializeCompletion(row)
  return serializePublicResponse(row)
}
