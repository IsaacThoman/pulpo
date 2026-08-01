import type { Message } from './types'

/** Keep optimistic turns that a stale server detail would otherwise wipe. */
export function mergePendingLocalMessages(
  serverMessages: Message[],
  localMessages: Message[] | undefined,
  streamingId: string | null = null,
): Message[] {
  if (!localMessages?.length) return serverMessages
  if (!serverMessages.length) {
    if (!streamingId) return serverMessages
    const assistant = localMessages.find((message) => message.id === streamingId && message.role === 'assistant' && !message.done)
    if (!assistant) return serverMessages
    const user = localMessages.find((message) => message.id === `${streamingId}:input` && message.role === 'user')
    return user ? [user, assistant] : [assistant]
  }

  const serverIds = new Set(serverMessages.map((message) => message.id))
  const pending: Message[] = []
  for (let index = localMessages.length - 1; index >= 0; index -= 1) {
    const message = localMessages[index]!
    if (serverIds.has(message.id)) break
    if (message.role === 'user' && message.id.endsWith(':input')) {
      const responseId = message.id.slice(0, -':input'.length)
      if (serverIds.has(responseId)) break
    }
    pending.unshift(message)
  }
  if (!pending.length) return serverMessages

  const hasInFlight = pending.some((message) => message.role === 'assistant' && !message.done)
  const lastServerId = serverMessages.at(-1)?.id
  const lastServerLocalIndex = lastServerId ? localMessages.findIndex((message) => message.id === lastServerId) : -1
  const serverIsLocalPrefix = lastServerLocalIndex >= 0
    && serverMessages.every((message) => localMessages.some((local) => local.id === message.id))
    && lastServerLocalIndex === serverMessages.length - 1

  if (hasInFlight || serverIsLocalPrefix) return [...serverMessages, ...pending]
  return serverMessages
}
