function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((rawPart) => {
    if (typeof rawPart === 'string') return rawPart
    const part = record(rawPart)
    if (!part) return ''
    if (typeof part.text === 'string') return part.text
    if (typeof part.content === 'string') return part.content
    if (typeof part.refusal === 'string') return part.refusal
    return ''
  }).join('')
}

/** Extract text that the chat clients can display as an assistant response. */
export function assistantOutputText(output: unknown): string {
  if (!Array.isArray(output)) return ''
  return output.flatMap((raw) => {
    const item = record(raw)
    if (item?.type !== 'message') return []
    const text = contentText(item.content)
    return text ? [text] : []
  }).join('\n')
}

export function outputContainsToolCall(output: unknown): boolean {
  if (!Array.isArray(output)) return false
  return output.some((raw) => {
    const type = record(raw)?.type
    return typeof type === 'string' && (type.endsWith('_call') || type === 'pulpo_tool')
  })
}

/** Whether a streamed attempt has emitted substantive model output that must not be duplicated by a retry. */
export function generationOutputHasStarted(output: unknown): boolean {
  if (!Array.isArray(output)) return false
  if (assistantOutputText(output) || outputContainsToolCall(output)) return true
  return output.some((raw) => {
    const item = record(raw)
    return item?.type === 'reasoning' && Boolean(contentText(item.summary))
  })
}

/** Detect generated content carried directly by a stream event before it reaches the output projection. */
export function generationEventHasStartedOutput(type: string, payload: unknown): boolean {
  const event = record(payload)
  if (!event) return false
  if (type.startsWith('response.') && type.endsWith('.delta')) {
    const delta = event.delta
    return typeof delta === 'string' ? delta.length > 0 : delta !== undefined && delta !== null
  }
  if (type === 'response.output_item.added' || type === 'response.output_item.done') {
    return generationOutputHasStarted([event.item])
  }
  return false
}

/** A browser chat must finish with content its transcript can actually render. */
export function browserChatOutputError(output: unknown): string | undefined {
  if (assistantOutputText(output).trim()) return undefined
  return outputContainsToolCall(output)
    ? 'The model returned a tool call without a final response. Enable Agent mode and try again.'
    : 'The model completed without a text response. Try again or choose a lower reasoning effort.'
}
