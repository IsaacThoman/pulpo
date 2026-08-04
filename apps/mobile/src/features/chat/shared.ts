export type PublicShareResponse = {
  id: string
  input: unknown[]
  output: unknown[]
  modelId: string
}

export type SharedMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  modelId: string
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map((part) => {
    if (typeof part === 'string') return part
    const item = part as { text?: string; content?: unknown; refusal?: string }
    return item.text ?? (item.content === undefined ? item.refusal ?? '' : contentText(item.content))
  }).join('')
}

function inputText(input: unknown[]): string {
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index] as { role?: string; content?: unknown }
    if (item.role === 'user') return contentText(item.content)
  }
  return ''
}

function outputText(output: unknown[]): string {
  return output.flatMap((item) => {
    const value = item as { type?: string; content?: unknown }
    return value.type === 'message' ? [contentText(value.content)] : []
  }).filter(Boolean).join('\n\n')
}

export function projectSharedMessages(responses: PublicShareResponse[]): SharedMessage[] {
  return responses.flatMap((response) => [
    { id: `${response.id}:input`, role: 'user', text: inputText(response.input), modelId: response.modelId },
    { id: response.id, role: 'assistant', text: outputText(response.output), modelId: response.modelId },
  ])
}
