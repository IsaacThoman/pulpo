export type AssistantGenerationStatus = 'idle' | 'thinking' | 'streaming'

interface GenerationMessage {
  id: string
  role: 'user' | 'assistant'
  status?: 'complete' | 'streaming' | 'queued' | 'failed' | 'stopped'
}

export function selectedInFlightResponseId(messages: readonly GenerationMessage[]): string | undefined {
  return [...messages].reverse().find((message) => (
    message.role === 'assistant' && (message.status === 'queued' || message.status === 'streaming')
  ))?.id
}

export function selectedAssistantStatus(messages: readonly GenerationMessage[]): AssistantGenerationStatus {
  const responseId = selectedInFlightResponseId(messages)
  if (!responseId) return 'idle'
  return messages.find((message) => message.id === responseId)?.status === 'streaming' ? 'streaming' : 'thinking'
}

export function composerGenerationAction(
  status: AssistantGenerationStatus,
  editingMessage: boolean,
  hasDraft = false,
): 'stop' | 'submit' {
  return status !== 'idle' && !editingMessage && !hasDraft ? 'stop' : 'submit'
}
