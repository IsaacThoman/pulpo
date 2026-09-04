import type { EmbeddedResponseSnapshot, ResponseSnapshot } from '@pulpo/contracts'
import type { chats, responses } from '../database/schema.js'
import { lineageFromLeaf, metadataForTurn } from '../messages/branching.js'
import { toSnapshot } from '../responses/service.js'
import { responseDisplayModelId } from './modelIdentity.js'

type ChatRow = typeof chats.$inferSelect
type ResponseRow = typeof responses.$inferSelect
type ResponseUsageCost = { costMicros: number; subscriptionCoveredMicros: number }

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
  costMicros: number | null
  subscriptionCoveredMicros: number | null
  error: unknown
  createdAt: string
  completedAt: string | null
  agentMode: boolean
  snapshot: ResponseSnapshot | EmbeddedResponseSnapshot
  branches: ReturnType<typeof metadataForTurn>
  detailAvailable: boolean
}

export function toPublicChatResponse(
  response: ResponseRow,
  allTurns: ResponseRow[],
  options: { compact?: boolean; usageCost?: ResponseUsageCost } = {},
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
    costMicros: options.usageCost?.costMicros ?? null,
    subscriptionCoveredMicros: options.usageCost?.subscriptionCoveredMicros ?? null,
    error: snapshot.error,
    createdAt: response.createdAt.toISOString(),
    completedAt: response.completedAt?.toISOString() ?? null,
    agentMode: response.agentMode,
    snapshot: options.compact ? snapshotMarker : snapshot,
    branches: metadataForTurn(allTurns, response),
    detailAvailable: true,
  }
}

/** Preserve branch topology without transferring inactive response bodies. */
export function toPublicChatResponseStub(
  response: ResponseRow,
  allTurns: ResponseRow[],
): PublicChatResponse {
  const full = toPublicChatResponse(response, allTurns, { compact: true })
  return {
    ...full,
    input: [],
    output: [],
    presetSelections: {},
    usage: null,
    error: null,
    detailAvailable: false,
  }
}

export function toPublicChatResponses(
  allTurns: ResponseRow[],
  activeLeafId: string | null,
  options: { compact?: boolean; activeOnly?: boolean; usageCostsByResponseId?: ReadonlyMap<string, ResponseUsageCost> } = {},
): PublicChatResponse[] {
  const activeIds = options.activeOnly
    ? new Set(lineageFromLeaf(allTurns, activeLeafId ?? allTurns.at(-1)?.id ?? null).map((response) => response.id))
    : undefined
  return allTurns.map((response) => activeIds && !activeIds.has(response.id)
    ? toPublicChatResponseStub(response, allTurns)
    : toPublicChatResponse(response, allTurns, {
        compact: options.compact,
        usageCost: options.usageCostsByResponseId?.get(response.id),
      }))
}

/** Return the newly active lineage so clients can render it without a follow-up chat fetch. */
export function toPublicBranchActivation(
  allTurns: ResponseRow[],
  activeBranchLeafId: string,
  usageCostsByResponseId?: ReadonlyMap<string, ResponseUsageCost>,
) {
  return {
    activeBranchLeafId,
    responses: toPublicChatResponses(allTurns, activeBranchLeafId, {
      compact: true,
      activeOnly: true,
      usageCostsByResponseId,
    }),
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
