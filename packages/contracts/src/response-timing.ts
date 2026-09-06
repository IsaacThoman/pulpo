export interface ResponseTiming {
  requestReceivedAt?: string | null
  firstReplyTextAt?: string | null
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

export function hasAssistantReplyText(output: unknown): boolean {
  return Array.isArray(output) && output.some((raw) => {
    const item = record(raw)
    if (item?.type !== 'message' || (item.role && item.role !== 'assistant')) return false
    if (typeof item.content === 'string') return Boolean(item.content.trim())
    return Array.isArray(item.content) && item.content.some((rawPart) => {
      const part = record(rawPart)
      const text = typeof rawPart === 'string' ? rawPart : part?.text ?? part?.content ?? part?.refusal
      return typeof text === 'string' && Boolean(text.trim())
    })
  })
}

/** Only reply text ends the initial wait; reasoning and tools do not. */
export function eventHasAssistantReplyText(type: string, payload: unknown): boolean {
  const value = record(payload)
  if (!value) return false
  if (type === 'response.output_text.delta' || type === 'response.output_text.done' || type === 'response.refusal.delta' || type === 'response.refusal.done') {
    const text = value.delta ?? value.text ?? value.refusal
    return typeof text === 'string' && Boolean(text.trim())
  }
  if (type === 'response.output_item.added' || type === 'response.output_item.done') return hasAssistantReplyText([value.item])
  if (type === 'response.content_part.added' || type === 'response.content_part.done') {
    return hasAssistantReplyText([{ type: 'message', content: [value.part] }])
  }
  return type.startsWith('response.') && hasAssistantReplyText(record(value.response)?.output)
}

/** Terminal timestamps are used only when no reply was emitted. */
export function initialResponseDurationMs(timing: ResponseTiming, terminalAt?: string | null): number | undefined {
  const start = Date.parse(timing.requestReceivedAt ?? '')
  const end = Date.parse(timing.firstReplyTextAt ?? terminalAt ?? '')
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined
}
