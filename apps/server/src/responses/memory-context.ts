import { chatAllowsMemory } from '../chats/memory-policy.js'
import { recalledChatContext, recallItemFromOutput, retrieveAutomaticRecall } from '../episodic-memory/automatic-recall.js'
import { memoryDocumentContext, readMemoryDocument } from '../memory-document/service.js'

/** Resolve fresh and persisted memory through the same policy for every generation path. */
export async function loadGenerationMemory(input: {
  chat: { temporary: boolean } | null | undefined
  memoryEnabled: unknown
  publicApi?: boolean
  userId: string
  responseId: string
  currentChatId: string
  query: string
  output: unknown
}) {
  const enabled = chatAllowsMemory(input.chat) && input.memoryEnabled === true && !input.publicApi
  if (!enabled) return { enabled: false, memoryContext: '', recallContext: '', recallItem: null, reusedRecall: false }
  const memoryContext = memoryDocumentContext(await readMemoryDocument(input.userId))
  const existing = recallItemFromOutput(input.output, input.responseId)
  const recallItem = existing ?? await retrieveAutomaticRecall(input)
  return { enabled: true, memoryContext, recallContext: recalledChatContext(recallItem), recallItem, reusedRecall: existing !== null }
}

export function generationSystemPrompt(memoryEnabled: boolean, current: string, persisted: string | null | undefined): string {
  // A persisted prompt may contain account memory from an earlier policy or preference.
  return memoryEnabled ? persisted ?? current : current
}
