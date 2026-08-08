import type { EmbeddedResponseSnapshot, ResponseSnapshot } from '@pulpo/contracts'
import type { chats, responses } from '../database/schema.js'
import { metadataForTurn } from '../messages/branching.js'
import { toSnapshot } from '../responses/service.js'
import { responseDisplayModelId } from './modelIdentity.js'

type ChatRow = typeof chats.$inferSelect
type ResponseRow = typeof responses.$inferSelect

export interface PublicChatResponse {
  id: string
  parentResponseId: string | null
  previousResponseId: string | null
  userMessageId: string | null
  modelId: string
  displayModelId: string
  status: ResponseSnapshot['status']
  input: unknown[]
  output: unknown[]
  presetSelections: Record<string, string>
  usage: ResponseSnapshot['usage']
  error: unknown
  createdAt: string
  completedAt: string | null
  agentMode: boolean
  snapshot: ResponseSnapshot | EmbeddedResponseSnapshot
  branches: ReturnType<typeof metadataForTurn>
}

export function toPublicChatResponse(
  response: ResponseRow,
  allTurns: ResponseRow[],
  options: { compact?: boolean } = {},
): PublicChatResponse {
  const snapshot = toSnapshot(response)
  const { output: _duplicatedOutput, ...snapshotMarker } = snapshot
  return {
    id: response.id,
    parentResponseId: response.parentResponseId,
    previousResponseId: response.previousResponseId,
    userMessageId: response.userMessageId,
    modelId: response.modelId,
    displayModelId: responseDisplayModelId(response),
    status: response.status,
    input: response.input as unknown[],
    output: snapshot.output,
    presetSelections: response.presetSelections as Record<string, string>,
    usage: snapshot.usage,
    error: snapshot.error,
    createdAt: response.createdAt.toISOString(),
    completedAt: response.completedAt?.toISOString() ?? null,
    agentMode: response.agentMode,
    snapshot: options.compact ? snapshotMarker : snapshot,
    branches: metadataForTurn(allTurns, response),
  }
}

export function toPublicChat(chat: ChatRow) {
  return {
    id: chat.id,
    title: chat.title,
    modelId: chat.modelId,
    pinned: chat.pinned,
    folderId: chat.folderId,
    sortOrder: chat.sortOrder,
    temporary: chat.temporary,
    activeResponseId: chat.activeResponseId,
    activeBranchLeafId: chat.activeBranchLeafId,
    expiresAt: chat.expiresAt?.toISOString() ?? null,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  }
}
