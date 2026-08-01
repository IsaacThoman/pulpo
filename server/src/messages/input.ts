type InputItem = { role?: string; content?: unknown }
type InputPart = { type?: string; text?: string; attachment_id?: string }

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

export function replaceResponseInputText(input: unknown, text: string): unknown[] {
  const items = Array.isArray(input) ? [...input] : []
  const userIndex = items.findLastIndex((item) => (item as InputItem).role === 'user')
  if (userIndex < 0) return [...items, { role: 'user', content: [{ type: 'input_text', text }] }]

  const user = items[userIndex] as InputItem
  if (!Array.isArray(user.content)) {
    items[userIndex] = { ...user, content: text }
    return items
  }

  let replaced = false
  const content = user.content.flatMap((part) => {
    const typed = part as InputPart
    if (typed.type !== 'input_text') return [part]
    if (replaced) return []
    replaced = true
    return [{ ...typed, text }]
  })
  if (!replaced) content.unshift({ type: 'input_text', text })
  items[userIndex] = { ...user, content }
  return items
}
