type InputItem = { role?: string; content?: unknown }
type InputPart = { type?: string; text?: string; attachment_id?: string }

function lastUserIndex(input: unknown[]): number {
  return input.findLastIndex((item) => (item as InputItem).role === 'user')
}

export function responseInputText(input: unknown): string {
  if (!Array.isArray(input)) return ''
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index] as InputItem
    if (item.role !== 'user') continue
    if (typeof item.content === 'string') return item.content
    if (Array.isArray(item.content)) {
      return item.content.map((part) => (part as InputPart).text ?? '').join('')
    }
  }
  return ''
}

export function responseAttachmentIds(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const content = (item as InputItem).content
    if (!Array.isArray(content)) return []
    return content.flatMap((part) => {
      const typed = part as InputPart
      return typed.type === 'input_file' && typed.attachment_id ? [typed.attachment_id] : []
    })
  })
}

export function responseUserAttachmentIds(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const userIndex = lastUserIndex(input)
  if (userIndex < 0) return []
  const content = (input[userIndex] as InputItem).content
  if (!Array.isArray(content)) return []
  return content.flatMap((part) => {
    const typed = part as InputPart
    return typed.type === 'input_file' && typed.attachment_id ? [typed.attachment_id] : []
  })
}

export function replaceResponseUserInput(input: unknown, text: string, attachmentIds: string[]): unknown[] {
  const items = Array.isArray(input) ? [...input] : []
  const userIndex = lastUserIndex(items)
  const replacement = [
    { type: 'input_text', text },
    ...attachmentIds.map((attachmentId) => ({ type: 'input_file', attachment_id: attachmentId })),
  ]
  if (userIndex < 0) return [...items, { role: 'user', content: replacement }]

  const user = items[userIndex] as InputItem
  const untouched = Array.isArray(user.content)
    ? user.content.filter((part) => {
        const type = (part as InputPart).type
        return type !== 'input_text' && type !== 'input_file'
      })
    : []
  items[userIndex] = { ...user, content: [...replacement, ...untouched] }
  return items
}

export function replaceResponseInputText(input: unknown, text: string): unknown[] {
  return replaceResponseUserInput(input, text, responseUserAttachmentIds(input))
}
