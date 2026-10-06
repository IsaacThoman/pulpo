/**
 * Provider-neutral view of a Responses API request body. Pulpo builds every
 * generation as a Responses request; the Chat Completions and Anthropic
 * adapters translate from this shape instead of re-parsing item variants.
 */

export type NeutralPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; detail?: string }
  | { type: 'file'; filename?: string; fileData?: string; fileId?: string }

export type NeutralReasoning = {
  text: string
  format?: string
  model?: string
  signature?: string
  redactedData?: string
}

export type NeutralEntry =
  | { kind: 'system'; text: string }
  | { kind: 'user'; parts: NeutralPart[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'reasoning'; reasoning: NeutralReasoning }
  | { kind: 'function_call'; callId: string; name: string; arguments: string }
  | { kind: 'function_output'; callId: string; output: NeutralPart[] }

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function contentParts(content: unknown): NeutralPart[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  if (!Array.isArray(content)) return []
  const parts: NeutralPart[] = []
  for (const raw of content) {
    if (typeof raw === 'string') {
      if (raw) parts.push({ type: 'text', text: raw })
      continue
    }
    const part = record(raw)
    if (!part) continue
    const type = part.type
    if ((type === 'input_text' || type === 'output_text' || type === 'text' || type === 'summary_text') && typeof part.text === 'string') {
      if (part.text) parts.push({ type: 'text', text: part.text })
    } else if (type === 'refusal' && typeof part.refusal === 'string') {
      if (part.refusal) parts.push({ type: 'text', text: part.refusal })
    } else if (type === 'input_image') {
      const url = typeof part.image_url === 'string' ? part.image_url : record(part.image_url)?.url
      if (typeof url === 'string' && url) parts.push({ type: 'image', url, ...(typeof part.detail === 'string' ? { detail: part.detail } : {}) })
    } else if (type === 'input_file') {
      const file: NeutralPart = {
        type: 'file',
        ...(typeof part.filename === 'string' ? { filename: part.filename } : {}),
        ...(typeof part.file_data === 'string' ? { fileData: part.file_data } : {}),
        ...(typeof part.file_id === 'string' ? { fileId: part.file_id } : {}),
      }
      if (file.fileData || file.fileId) parts.push(file)
    }
  }
  return parts
}

export function partsText(parts: NeutralPart[]): string {
  return parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n')
}

function functionOutput(output: unknown): NeutralPart[] {
  if (typeof output === 'string') return [{ type: 'text', text: output }]
  if (Array.isArray(output)) return contentParts(output)
  if (output === undefined || output === null) return []
  return [{ type: 'text', text: JSON.stringify(output) }]
}

function reasoningEntry(item: JsonRecord): NeutralReasoning {
  const text = Array.isArray(item.summary)
    ? item.summary.map((part) => record(part)?.text).filter((value): value is string => typeof value === 'string').join('\n')
    : ''
  return {
    text,
    ...(typeof item.pulpo_format === 'string' ? { format: item.pulpo_format } : {}),
    ...(typeof item.pulpo_model === 'string' ? { model: item.pulpo_model } : {}),
    ...(typeof item.pulpo_signature === 'string' ? { signature: item.pulpo_signature } : {}),
    ...(typeof item.pulpo_redacted_data === 'string' ? { redactedData: item.pulpo_redacted_data } : {}),
  }
}

/** Flatten `instructions` and `input` into ordered, provider-neutral entries. */
export function neutralConversation(payload: { input?: unknown; instructions?: unknown }): NeutralEntry[] {
  const entries: NeutralEntry[] = []
  if (typeof payload.instructions === 'string' && payload.instructions.trim()) entries.push({ kind: 'system', text: payload.instructions })
  const input = payload.input
  if (typeof input === 'string') {
    if (input) entries.push({ kind: 'user', parts: [{ type: 'text', text: input }] })
    return entries
  }
  if (!Array.isArray(input)) return entries
  for (const raw of input) {
    const item = record(raw)
    if (!item) continue
    const type = typeof item.type === 'string' ? item.type : 'message'
    if (type === 'message' || (type !== 'function_call' && type !== 'function_call_output' && type !== 'reasoning' && typeof item.role === 'string')) {
      const parts = contentParts(item.content)
      if (item.role === 'system' || item.role === 'developer') {
        const text = partsText(parts)
        if (text.trim()) entries.push({ kind: 'system', text })
      } else if (item.role === 'assistant') {
        const text = partsText(parts)
        if (text) entries.push({ kind: 'assistant', text })
      } else if (item.role === 'user') {
        if (parts.length) entries.push({ kind: 'user', parts })
      }
      continue
    }
    if (type === 'function_call' && typeof item.name === 'string') {
      const callId = typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : `call_${entries.length}`
      entries.push({ kind: 'function_call', callId, name: item.name, arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}) })
      continue
    }
    if (type === 'function_call_output' && typeof item.call_id === 'string') {
      entries.push({ kind: 'function_output', callId: item.call_id, output: functionOutput(item.output) })
      continue
    }
    if (type === 'reasoning') entries.push({ kind: 'reasoning', reasoning: reasoningEntry(item) })
    // Pulpo bookkeeping items and provider-hosted item types have no portable form.
  }
  return entries
}

export type ParsedDataUrl = { mediaType: string; data: string }

export function parseDataUrl(url: string): ParsedDataUrl | undefined {
  const match = /^data:([^;,]+)?((?:;[^;,]+)*?);base64,(.*)$/s.exec(url)
  if (!match) return undefined
  return { mediaType: (match[1] ?? 'application/octet-stream').toLowerCase(), data: match[3] ?? '' }
}

/** Text-like files can be inlined as plain text for protocols without file inputs. */
export function isTextMediaType(mediaType: string): boolean {
  return mediaType.startsWith('text/')
    || ['application/json', 'application/xml', 'application/javascript', 'application/x-yaml', 'application/yaml', 'application/toml', 'application/csv'].includes(mediaType)
}

const STRUCTURAL_KEYS = new Set([
  'model', 'input', 'instructions', 'stream', 'store', 'background', 'include', 'max_output_tokens',
  'temperature', 'top_p', 'tools', 'tool_choice', 'parallel_tool_calls', 'reasoning', 'text',
  'service_tier', 'prompt_cache_key', 'prompt_cache_retention', 'prompt_cache_options', 'safety_identifier',
  'stream_options', 'top_logprobs', 'truncation', 'metadata', 'previous_response_id', 'conversation',
  'cache_control', 'user', 'max_tool_calls', 'context_management', 'prompt', 'moderation',
])

/**
 * Admin-configured default parameters that are not Responses API concepts
 * (`top_k`, `repetition_penalty`, `thinking`, ...) pass straight through to
 * the translated request so operators can reach provider-specific knobs.
 */
export function passthroughParameters(payload: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(payload).filter(([key, value]) => !STRUCTURAL_KEYS.has(key) && value !== undefined))
}

export function functionTools(tools: unknown): Array<{ name: string; description?: string; parameters?: unknown; strict?: boolean }> {
  if (!Array.isArray(tools)) return []
  return tools.flatMap((raw) => {
    const tool = record(raw)
    if (!tool || tool.type !== 'function' || typeof tool.name !== 'string') return []
    return [{
      name: tool.name,
      ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
      ...(tool.parameters !== undefined && tool.parameters !== null ? { parameters: tool.parameters } : {}),
      ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
    }]
  })
}

export type NeutralToolChoice = 'auto' | 'none' | 'required' | { name: string } | undefined

export function neutralToolChoice(value: unknown): NeutralToolChoice {
  if (value === 'auto' || value === 'none' || value === 'required') return value
  const choice = record(value)
  if (choice?.type === 'function' && typeof choice.name === 'string') return { name: choice.name }
  return undefined
}

export type NeutralTextFormat =
  | { type: 'json_object' }
  | { type: 'json_schema'; name: string; schema: unknown; description?: string; strict?: boolean }
  | undefined

export function neutralTextFormat(text: unknown): NeutralTextFormat {
  const format = record(record(text)?.format)
  if (format?.type === 'json_object') return { type: 'json_object' }
  if (format?.type === 'json_schema' && format.schema !== undefined) {
    return {
      type: 'json_schema',
      name: typeof format.name === 'string' ? format.name : 'response',
      schema: format.schema,
      ...(typeof format.description === 'string' ? { description: format.description } : {}),
      ...(typeof format.strict === 'boolean' ? { strict: format.strict } : {}),
    }
  }
  return undefined
}

export function reasoningEffort(reasoning: unknown): string | undefined {
  const effort = record(reasoning)?.effort
  return typeof effort === 'string' ? effort : undefined
}
