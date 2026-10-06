import type { ProviderApiFormat } from '@pulpo/contracts'

/** One OpenAI Responses API streaming event, as the worker consumes them. */
export type ResponsesStreamEvent = { type: string; sequence_number: number; [key: string]: unknown }

export type ResponsesUsage = {
  input_tokens: number
  input_tokens_details: { cached_tokens: number; cache_write_tokens: number }
  output_tokens: number
  output_tokens_details: { reasoning_tokens: number }
  total_tokens: number
  cost?: number
}

export type ResponsesResult = {
  id: string
  object: 'response'
  created_at: number
  model: string
  status: 'in_progress' | 'completed' | 'incomplete' | 'failed'
  output: Array<Record<string, unknown>>
  output_text: string
  usage: ResponsesUsage | null
  incomplete_details: { reason: string } | null
  error: null
}

export function responsesUsage(input: {
  inputTokens: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  outputTokens: number
  reasoningTokens?: number
  cost?: number
}): ResponsesUsage {
  const inputTokens = Math.max(0, input.inputTokens)
  const outputTokens = Math.max(0, input.outputTokens)
  return {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: Math.max(0, input.cachedInputTokens ?? 0), cache_write_tokens: Math.max(0, input.cacheWriteTokens ?? 0) },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: Math.max(0, input.reasoningTokens ?? 0) },
    total_tokens: inputTokens + outputTokens,
    ...(typeof input.cost === 'number' && Number.isFinite(input.cost) && input.cost >= 0 ? { cost: input.cost } : {}),
  }
}

/** Content indexes are assigned in the order parts open, so streamed and final indexes agree. */
type MessageState = { kind: 'message'; index: number; id: string; text: string; refusal: string; textIndex?: number; refusalIndex?: number; done: boolean }
type ReasoningState = { kind: 'reasoning'; index: number; id: string; text: string; opened: boolean; done: boolean; signature?: string; redactedData?: string }
type FunctionState = { kind: 'function_call'; index: number; id: string; callId: string; name: string; arguments: string; done: boolean }
type ItemState = MessageState | ReasoningState | FunctionState

/**
 * Builds a Responses API event stream from another protocol's deltas. The
 * worker, the stored transcript, and every public projector understand only
 * Responses events, so translated providers must look exactly like one.
 */
export class ResponsesStreamBuilder {
  private sequence = 0
  private readonly items: ItemState[] = []
  private readonly reasoningByKey = new Map<string, ReasoningState>()
  private readonly functionsByKey = new Map<string, FunctionState>()
  private message: MessageState | undefined
  private started = false
  private finished = false
  private responseId: string
  private model: string
  private readonly createdAt = Math.floor(Date.now() / 1_000)

  constructor(
    private readonly sourceFormat: Exclude<ProviderApiFormat, 'openai_responses'>,
    initial: { id?: string; model: string },
    private readonly upstreamModel: string = initial.model,
  ) {
    this.responseId = initial.id ?? `resp_pulpo_${Math.random().toString(36).slice(2)}`
    this.model = initial.model
  }

  get id(): string { return this.responseId }

  private event(type: string, payload: Record<string, unknown>): ResponsesStreamEvent {
    return { type, sequence_number: this.sequence++, ...payload }
  }

  private shell(status: ResponsesResult['status'], extra: Partial<ResponsesResult> = {}): ResponsesResult {
    return {
      id: this.responseId, object: 'response', created_at: this.createdAt, model: this.model, status,
      output: [], output_text: '', usage: null, incomplete_details: null, error: null, ...extra,
    }
  }

  /** Emit `response.created` once the upstream id is known (or on first content). */
  start(identity: { id?: string; model?: string } = {}): ResponsesStreamEvent[] {
    if (this.started) return []
    if (identity.id) this.responseId = identity.id
    if (identity.model) this.model = identity.model
    this.started = true
    const response = this.shell('in_progress')
    return [this.event('response.created', { response }), this.event('response.in_progress', { response })]
  }

  private ensureStarted(events: ResponsesStreamEvent[]): void {
    events.push(...this.start())
  }

  private ensureMessage(events: ResponsesStreamEvent[]): MessageState {
    this.ensureStarted(events)
    if (this.message && !this.message.done) return this.message
    const state: MessageState = { kind: 'message', index: this.items.length, id: `msg_${this.responseId}_${this.items.length}`, text: '', refusal: '', done: false }
    this.items.push(state)
    this.message = state
    events.push(this.event('response.output_item.added', {
      output_index: state.index,
      item: { id: state.id, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
    }))
    return state
  }

  private messageParts(state: MessageState): Array<Record<string, unknown>> {
    const parts: Array<{ index: number; part: Record<string, unknown> }> = []
    if (state.textIndex !== undefined) parts.push({ index: state.textIndex, part: { type: 'output_text', text: state.text, annotations: [] } })
    if (state.refusalIndex !== undefined) parts.push({ index: state.refusalIndex, part: { type: 'refusal', refusal: state.refusal } })
    return parts.sort((left, right) => left.index - right.index).map((entry) => entry.part)
  }

  text(delta: string): ResponsesStreamEvent[] {
    if (!delta) return []
    const events: ResponsesStreamEvent[] = []
    const state = this.ensureMessage(events)
    if (state.textIndex === undefined) {
      state.textIndex = state.refusalIndex === undefined ? 0 : 1
      events.push(this.event('response.content_part.added', { item_id: state.id, output_index: state.index, content_index: state.textIndex, part: { type: 'output_text', text: '', annotations: [] } }))
    }
    const contentIndex = state.textIndex
    state.text += delta
    events.push(this.event('response.output_text.delta', { item_id: state.id, output_index: state.index, content_index: contentIndex, delta, logprobs: [] }))
    return events
  }

  refusal(delta: string): ResponsesStreamEvent[] {
    if (!delta) return []
    const events: ResponsesStreamEvent[] = []
    const state = this.ensureMessage(events)
    if (state.refusalIndex === undefined) {
      state.refusalIndex = state.textIndex === undefined ? 0 : 1
      events.push(this.event('response.content_part.added', { item_id: state.id, output_index: state.index, content_index: state.refusalIndex, part: { type: 'refusal', refusal: '' } }))
    }
    const contentIndex = state.refusalIndex
    state.refusal += delta
    events.push(this.event('response.refusal.delta', { item_id: state.id, output_index: state.index, content_index: contentIndex, delta }))
    return events
  }

  private closeMessage(state: MessageState): ResponsesStreamEvent[] {
    if (state.done) return []
    state.done = true
    const events: ResponsesStreamEvent[] = []
    const parts: Array<{ index: number; emit: (content_index: number) => void }> = []
    if (state.textIndex !== undefined) parts.push({ index: state.textIndex, emit: (content_index) => {
      events.push(this.event('response.output_text.done', { item_id: state.id, output_index: state.index, content_index, text: state.text, logprobs: [] }))
      events.push(this.event('response.content_part.done', { item_id: state.id, output_index: state.index, content_index, part: { type: 'output_text', text: state.text, annotations: [] } }))
    } })
    if (state.refusalIndex !== undefined) parts.push({ index: state.refusalIndex, emit: (content_index) => {
      events.push(this.event('response.refusal.done', { item_id: state.id, output_index: state.index, content_index, refusal: state.refusal }))
      events.push(this.event('response.content_part.done', { item_id: state.id, output_index: state.index, content_index, part: { type: 'refusal', refusal: state.refusal } }))
    } })
    for (const part of parts.sort((left, right) => left.index - right.index)) part.emit(part.index)
    events.push(this.event('response.output_item.done', { output_index: state.index, item: this.itemPayload(state, 'completed') }))
    if (this.message === state) this.message = undefined
    return events
  }

  private ensureReasoning(key: string, events: ResponsesStreamEvent[]): ReasoningState {
    this.ensureStarted(events)
    const existing = this.reasoningByKey.get(key)
    if (existing) return existing
    // Text that preceded this reasoning block is finished; later text opens a new message item.
    if (this.message) events.push(...this.closeMessage(this.message))
    const state: ReasoningState = { kind: 'reasoning', index: this.items.length, id: `rs_pulpo_${this.responseId}_${this.items.length}`, text: '', opened: false, done: false }
    this.items.push(state)
    this.reasoningByKey.set(key, state)
    events.push(this.event('response.output_item.added', { output_index: state.index, item: { id: state.id, type: 'reasoning', summary: [] } }))
    return state
  }

  /** Start a reasoning item even before it has visible text (e.g. omitted Anthropic thinking). */
  reasoningStart(key: string): ResponsesStreamEvent[] {
    const events: ResponsesStreamEvent[] = []
    this.ensureReasoning(key, events)
    return events
  }

  reasoning(key: string, delta: string): ResponsesStreamEvent[] {
    if (!delta) return []
    const events: ResponsesStreamEvent[] = []
    const state = this.ensureReasoning(key, events)
    if (state.done) return events
    if (!state.opened) {
      state.opened = true
      events.push(this.event('response.reasoning_summary_part.added', { item_id: state.id, output_index: state.index, summary_index: 0, part: { type: 'summary_text', text: '' } }))
    }
    state.text += delta
    events.push(this.event('response.reasoning_summary_text.delta', { item_id: state.id, output_index: state.index, summary_index: 0, delta }))
    return events
  }

  hasReasoning(key: string): boolean {
    return this.reasoningByKey.has(key)
  }

  reasoningSignature(key: string, signature: string): void {
    const state = this.reasoningByKey.get(key)
    if (state) state.signature = `${state.signature ?? ''}${signature}`
  }

  redactedReasoning(key: string, data: string): ResponsesStreamEvent[] {
    const events: ResponsesStreamEvent[] = []
    const state = this.ensureReasoning(key, events)
    state.redactedData = data
    return events
  }

  reasoningDone(key: string): ResponsesStreamEvent[] {
    const state = this.reasoningByKey.get(key)
    if (!state || state.done) return []
    state.done = true
    const events: ResponsesStreamEvent[] = []
    if (state.opened) {
      events.push(this.event('response.reasoning_summary_text.done', { item_id: state.id, output_index: state.index, summary_index: 0, text: state.text }))
      events.push(this.event('response.reasoning_summary_part.done', { item_id: state.id, output_index: state.index, summary_index: 0, part: { type: 'summary_text', text: state.text } }))
    }
    events.push(this.event('response.output_item.done', { output_index: state.index, item: this.itemPayload(state, 'completed') }))
    return events
  }

  functionCall(key: string, start: { callId?: string; name?: string }): ResponsesStreamEvent[] {
    const events: ResponsesStreamEvent[] = []
    this.ensureStarted(events)
    const existing = this.functionsByKey.get(key)
    if (existing) {
      if (start.name && !existing.name) existing.name = start.name
      if (start.callId && !existing.callId) existing.callId = start.callId
      return events
    }
    if (this.message) events.push(...this.closeMessage(this.message))
    const index = this.items.length
    const state: FunctionState = {
      kind: 'function_call', index, id: `fc_${this.responseId}_${index}`,
      callId: start.callId ?? `call_${this.responseId}_${index}`, name: start.name ?? '', arguments: '', done: false,
    }
    this.items.push(state)
    this.functionsByKey.set(key, state)
    events.push(this.event('response.output_item.added', { output_index: index, item: this.itemPayload(state, 'in_progress') }))
    return events
  }

  functionArguments(key: string, delta: string): ResponsesStreamEvent[] {
    if (!delta) return []
    const events = this.functionCall(key, {})
    const state = this.functionsByKey.get(key)!
    if (state.done) return events
    state.arguments += delta
    events.push(this.event('response.function_call_arguments.delta', { item_id: state.id, output_index: state.index, delta }))
    return events
  }

  functionDone(key: string): ResponsesStreamEvent[] {
    const state = this.functionsByKey.get(key)
    if (!state || state.done) return []
    state.done = true
    if (!state.arguments.trim()) state.arguments = '{}'
    return [
      this.event('response.function_call_arguments.done', { item_id: state.id, output_index: state.index, name: state.name, arguments: state.arguments }),
      this.event('response.output_item.done', { output_index: state.index, item: this.itemPayload(state, 'completed') }),
    ]
  }

  private itemPayload(state: ItemState, status: 'in_progress' | 'completed'): Record<string, unknown> {
    if (state.kind === 'message') {
      return { id: state.id, type: 'message', role: 'assistant', status, content: this.messageParts(state) }
    }
    if (state.kind === 'reasoning') {
      return {
        id: state.id, type: 'reasoning',
        summary: state.text ? [{ type: 'summary_text', text: state.text }] : [],
        // Server-only continuation data for the protocol that produced it. The
        // Responses path strips items carrying `pulpo_format` before sending.
        pulpo_format: this.sourceFormat,
        pulpo_model: this.upstreamModel,
        ...(state.signature ? { pulpo_signature: state.signature } : {}),
        ...(state.redactedData ? { pulpo_redacted_data: state.redactedData } : {}),
      }
    }
    return { id: state.id, type: 'function_call', status, call_id: state.callId, name: state.name, arguments: state.arguments }
  }

  private closeAll(): ResponsesStreamEvent[] {
    const events: ResponsesStreamEvent[] = []
    for (const state of this.items) {
      if (state.done) continue
      if (state.kind === 'message') events.push(...this.closeMessage(state))
      else if (state.kind === 'reasoning') events.push(...this.reasoningDone([...this.reasoningByKey].find(([, value]) => value === state)![0]))
      else events.push(...this.functionDone([...this.functionsByKey].find(([, value]) => value === state)![0]))
    }
    return events
  }

  /** The output array as it stands, for terminal events and non-stream results. */
  output(): Array<Record<string, unknown>> {
    return this.items
      .map((state) => this.itemPayload(state, state.done ? 'completed' : 'in_progress'))
      .filter((item) => item.type !== 'message' || (item.content as unknown[]).length > 0)
  }

  outputText(): string {
    return this.items.flatMap((state) => state.kind === 'message' ? [state.text] : []).join('')
  }

  finish(input: { usage: ResponsesUsage | null; incompleteReason?: string | null }): { events: ResponsesStreamEvent[]; result: ResponsesResult } {
    const events: ResponsesStreamEvent[] = []
    this.ensureStarted(events)
    events.push(...this.closeAll())
    this.finished = true
    const incomplete = Boolean(input.incompleteReason)
    const result = this.shell(incomplete ? 'incomplete' : 'completed', {
      output: this.output(),
      output_text: this.outputText(),
      usage: input.usage,
      incomplete_details: incomplete ? { reason: input.incompleteReason! } : null,
    })
    events.push(this.event(incomplete ? 'response.incomplete' : 'response.completed', { response: result }))
    return { events, result }
  }

  get isFinished(): boolean { return this.finished }
}
