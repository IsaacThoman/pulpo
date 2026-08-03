import type { AgentMessage } from '@earendil-works/pi-agent-core'

export function messagesForPersistence(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user' && message.role !== 'toolResult') return message
    if (!Array.isArray(message.content)) return message
    const content = message.content.filter((part) => part.type !== 'image')
    if (content.length) return { ...message, content }
    return { ...message, content: [{ type: 'text', text: '[Image data omitted from persisted agent context]' }] }
  })
}
