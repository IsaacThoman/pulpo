/**
 * Gemini's OpenAI-compatible endpoint attaches a thought signature to each tool
 * call (`extra_content.google.thought_signature`) and rejects the next request
 * with a bodiless 400 when a call comes back without it. Pi's Chat Completions
 * client neither keeps nor replays that field, so the agent captures it from the
 * raw stream and puts it back on the outgoing tool calls.
 */

type JsonRecord = Record<string, unknown>

/** Google's documented placeholder for calls it never signed, such as ones another model made. */
export const GEMINI_SKIP_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

export function isGeminiApiBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'generativelanguage.googleapis.com'
  } catch {
    return false
  }
}

function toolCallSignature(call: JsonRecord): string | undefined {
  const signature = record(record(call.extra_content)?.google)?.thought_signature
  return typeof signature === 'string' && signature ? signature : undefined
}

/** Signatures by tool call id from a Chat Completions stream or JSON body. */
export function thoughtSignaturesFromBody(body: string): Map<string, string> {
  const signatures = new Map<string, string>()
  const idsByIndex = new Map<number, string>()
  const read = (payload: unknown) => {
    for (const rawChoice of Array.isArray(record(payload)?.choices) ? record(payload)!.choices as unknown[] : []) {
      const choice = record(rawChoice)
      const calls = (record(choice?.delta) ?? record(choice?.message))?.tool_calls
      if (!Array.isArray(calls)) continue
      for (const [position, rawCall] of calls.entries()) {
        const call = record(rawCall)
        if (!call) continue
        const index = typeof call.index === 'number' ? call.index : position
        if (typeof call.id === 'string' && call.id) idsByIndex.set(index, call.id)
        const id = idsByIndex.get(index)
        const signature = toolCallSignature(call)
        if (id && signature) signatures.set(id, signature)
      }
    }
  }
  let sawEvent = false
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') continue
    sawEvent = true
    try { read(JSON.parse(data)) } catch { /* ignore non-JSON provider events */ }
  }
  if (!sawEvent) {
    try { read(JSON.parse(body)) } catch { /* ignore non-JSON response bodies */ }
  }
  return signatures
}

/** Put known signatures, or Google's placeholder, back on every outgoing tool call. */
export function withThoughtSignatures(payload: unknown, signatures: ReadonlyMap<string, string>, options: { placeholder: boolean }): unknown {
  const body = record(payload)
  if (!body || !Array.isArray(body.messages)) return payload
  let changed = false
  const messages = body.messages.map((rawMessage) => {
    const message = record(rawMessage)
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) return rawMessage
    let callsChanged = false
    const calls = message.tool_calls.map((rawCall) => {
      const call = record(rawCall)
      if (!call || toolCallSignature(call)) return rawCall
      const signature = (typeof call.id === 'string' ? signatures.get(call.id) : undefined) ?? (options.placeholder ? GEMINI_SKIP_THOUGHT_SIGNATURE : undefined)
      if (!signature) return rawCall
      callsChanged = true
      const extra = record(call.extra_content) ?? {}
      return { ...call, extra_content: { ...extra, google: { ...record(extra.google), thought_signature: signature } } }
    })
    if (!callsChanged) return rawMessage
    changed = true
    return { ...message, tool_calls: calls }
  })
  return changed ? { ...body, messages } : payload
}

export type ThoughtSignatureStore = {
  /** Records signatures from each response the wrapped fetch returns. */
  fetch: (baseFetch?: typeof globalThis.fetch) => typeof globalThis.fetch
  /** Waits for responses still being read, then signs the outgoing payload. */
  apply: (payload: unknown, options: { placeholder: boolean }) => Promise<unknown>
}

/** One store per agent run, so signatures follow the run's tool calls across turns. */
export function createThoughtSignatureStore(): ThoughtSignatureStore {
  const signatures = new Map<string, string>()
  const pending = new Set<Promise<void>>()
  return {
    fetch: (baseFetch = globalThis.fetch) => async (input, init) => {
      const response = await baseFetch(input, init)
      if (!response.ok || !response.body) return response
      const observation: Promise<void> = response.clone().text()
        .then((text) => { for (const [id, signature] of thoughtSignaturesFromBody(text)) signatures.set(id, signature) })
        .catch(() => undefined)
        .finally(() => pending.delete(observation))
      pending.add(observation)
      return response
    },
    apply: async (payload, options) => {
      await Promise.all(pending)
      return withThoughtSignatures(payload, signatures, options)
    },
  }
}
