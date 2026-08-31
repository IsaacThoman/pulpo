export interface CodexConversationExchange<T> {
  responseId: string
  messages: T[]
}

export function splitCodexConversationExchanges<T>(
  exchanges: CodexConversationExchange<T>[],
  retainedExchangeCount: number,
): {
  older: T[]
  retained: T[]
  retainedExchanges: T[][]
  coveredThroughResponseId?: string
} {
  const splitIndex = Math.max(0, exchanges.length - retainedExchangeCount)
  const olderExchanges = exchanges.slice(0, splitIndex)
  const retainedExchanges = exchanges.slice(splitIndex).map((exchange) => exchange.messages)
  return {
    older: olderExchanges.flatMap((exchange) => exchange.messages),
    retained: retainedExchanges.flat(),
    retainedExchanges,
    coveredThroughResponseId: olderExchanges.at(-1)?.responseId,
  }
}
