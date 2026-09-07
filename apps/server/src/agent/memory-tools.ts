import { createEpisodicMemoryTools } from '../episodic-memory/agent-tools.js'
import { createMemoryDocumentTool } from '../memory-document/agent-tool.js'

export function createGenerationMemoryTools(input: {
  memoryEnabled: boolean
  episodicMemoryEnabled: boolean
  userId: string
  responseId: string
  currentChatId: string
  maxOutputBytes: number
  onOperationStarted?: (operationId: string) => void | Promise<void>
}) {
  if (!input.memoryEnabled) return []
  return [
    ...(input.episodicMemoryEnabled ? createEpisodicMemoryTools(input) : []),
    createMemoryDocumentTool(input),
  ]
}
