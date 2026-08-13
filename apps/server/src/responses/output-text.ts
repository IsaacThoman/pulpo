function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Extract text that the chat clients can display as an assistant response. */
export function assistantOutputText(output: unknown): string {
  if (!Array.isArray(output)) return ''
  return output.flatMap((raw) => {
    const item = record(raw)
    if (item?.type !== 'message') return []
    if (typeof item.content === 'string') return item.content ? [item.content] : []
    if (!Array.isArray(item.content)) return []
    const text = item.content.flatMap((rawPart) => {
      if (typeof rawPart === 'string') return [rawPart]
      const part = record(rawPart)
      if (!part) return []
      if (typeof part.text === 'string') return [part.text]
      if (typeof part.content === 'string') return [part.content]
      if (typeof part.refusal === 'string') return [part.refusal]
      return []
    }).join('')
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

/** A browser chat must finish with content its transcript can actually render. */
export function browserChatOutputError(output: unknown): string | undefined {
  if (assistantOutputText(output).trim()) return undefined
  return outputContainsToolCall(output)
    ? 'The model returned a tool call without a final response. Enable Agent mode and try again.'
    : 'The model completed without a text response. Try again or choose a lower reasoning effort.'
}
