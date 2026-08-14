import type { Message } from './types'

/** Keep optimistic turns that a stale server detail would otherwise wipe. */
export function mergePendingLocalMessages(
  serverMessages: Message[],
  localMessages: Message[] | undefined,
  streamingIds: readonly string[] = [],
  knownResponseIds: ReadonlySet<string> = new Set(),
): Message[] {
  if (!localMessages?.length) return serverMessages
  if (!serverMessages.length) {
    const streaming = new Set(streamingIds)
    const keepIds = new Set<string>()
    for (const message of localMessages) {
      if (message.role === 'user' && message.deliveryStatus === 'uploading') keepIds.add(message.id)
      if (message.role !== 'assistant') continue
      if ((!message.done && streaming.has(message.id)) || message.error) {
        keepIds.add(message.id)
        keepIds.add(`${message.id}:input`)
      }
    }
    return localMessages.filter((message) => keepIds.has(message.id))
  }

  const serverIds = new Set(serverMessages.map((message) => message.id))
  const selectedResponseIds = new Set(serverMessages.map((message) => (
    message.role === 'user' && message.id.endsWith(':input')
      ? message.id.slice(0, -':input'.length)
      : message.id
  )))
  const relevantLocalMessages = localMessages.filter((message) => {
    const responseId = message.role === 'user' && message.id.endsWith(':input')
      ? message.id.slice(0, -':input'.length)
      : message.id
    return selectedResponseIds.has(responseId) || !knownResponseIds.has(responseId)
  })
  const pending: Message[] = []
  for (let index = relevantLocalMessages.length - 1; index >= 0; index -= 1) {
    const message = relevantLocalMessages[index]!
    if (serverIds.has(message.id)) break
    if (message.role === 'user' && message.id.endsWith(':input')) {
      const responseId = message.id.slice(0, -':input'.length)
      if (serverIds.has(responseId)) break
    }
    pending.unshift(message)
  }
  if (!pending.length) return serverMessages

  const hasLocalOnlyTurn = pending.some((message) =>
    (message.role === 'assistant' && (!message.done || Boolean(message.error)))
    || (message.role === 'user' && message.deliveryStatus === 'uploading'),
  )
  const lastServerId = serverMessages.at(-1)?.id
  const lastServerLocalIndex = lastServerId ? relevantLocalMessages.findIndex((message) => message.id === lastServerId) : -1
  const serverIsLocalPrefix = lastServerLocalIndex >= 0
    && serverMessages.every((message) => relevantLocalMessages.some((local) => local.id === message.id))
    && lastServerLocalIndex === serverMessages.length - 1

  if (hasLocalOnlyTurn || serverIsLocalPrefix) return [...serverMessages, ...pending]
  return serverMessages
}
