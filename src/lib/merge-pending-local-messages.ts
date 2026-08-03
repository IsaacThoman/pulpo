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
    const assistants = localMessages.filter((message) =>
      message.role === 'assistant'
      && ((!message.done && streaming.has(message.id)) || Boolean(message.error)),
    )
    if (!assistants.length) return serverMessages
    return assistants.flatMap((assistant) => {
      const user = localMessages.find((message) => message.id === `${assistant.id}:input` && message.role === 'user')
      return user ? [user, assistant] : [assistant]
    })
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
    message.role === 'assistant' && (!message.done || Boolean(message.error)),
  )
  const lastServerId = serverMessages.at(-1)?.id
  const lastServerLocalIndex = lastServerId ? relevantLocalMessages.findIndex((message) => message.id === lastServerId) : -1
  const serverIsLocalPrefix = lastServerLocalIndex >= 0
    && serverMessages.every((message) => relevantLocalMessages.some((local) => local.id === message.id))
    && lastServerLocalIndex === serverMessages.length - 1

  if (hasLocalOnlyTurn || serverIsLocalPrefix) return [...serverMessages, ...pending]
  return serverMessages
}
