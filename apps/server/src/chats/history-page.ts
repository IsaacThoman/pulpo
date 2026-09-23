import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../database/client.js'
import { attachments, responses, usageEvents } from '../database/schema.js'
import { branchMetadataIndex, lineageFromLeaf, type BranchTurn } from '../messages/branching.js'
import { responseAttachmentIds } from '../messages/input.js'
import { AppError } from '../lib/errors.js'
import { toPublicChatResponse } from './public.js'

export const historyPageQuery = z.object({
  historyLimit: z.coerce.number().int().min(1).max(1000),
  before: z.uuid().optional(),
})

export function selectHistoryPage<T extends BranchTurn>(turns: T[], leafId: string | null, limit: number, before?: string) {
  const lineage = lineageFromLeaf(turns, leafId ?? turns.at(-1)?.id ?? null)
  const end = before ? lineage.findIndex(turn => turn.id === before) : lineage.length
  if (end < 0) throw new AppError(409, 'history_changed', 'The conversation branch changed. Reload its history.')
  const start = Math.max(0, end - limit)
  return {
    turns: lineage.slice(start, end),
    history: { offset: start, hasMore: start > 0, before: lineage[start]?.id ?? null, leafId: lineage.at(-1)?.id ?? null },
  }
}

/** Only topology is read for older turns; response bodies/usage/attachments are bounded by the page. */
export async function loadHistoryPage(chatId: string, userId: string, leafId: string | null, limit: number, before?: string) {
  const topology = await db.select({
    id: responses.id, parentResponseId: responses.parentResponseId, userMessageId: responses.userMessageId,
    // Legacy messages group by their original input; modern turns need no body to identify siblings.
    input: sql<unknown>`case when ${responses.userMessageId} is null then ${responses.input} else '[]' end`,
  }).from(responses).where(and(eq(responses.chatId, chatId), eq(responses.userId, userId), isNull(responses.deletedAt)))
    .orderBy(asc(responses.createdAt), asc(responses.id))
  const graph = topology.map(turn => ({ ...turn, input: typeof turn.input === 'string' ? JSON.parse(turn.input) : turn.input }))
  const page = selectHistoryPage(graph, leafId, limit, before)
  const ids = page.turns.map(turn => turn.id)
  const rows = ids.length ? await db.select().from(responses).where(and(inArray(responses.id, ids), eq(responses.chatId, chatId), isNull(responses.deletedAt)))
    .orderBy(asc(responses.createdAt), asc(responses.id)) : []
  // A concurrent deletion must not splice disconnected history into a cached branch.
  if (rows.length !== ids.length) throw new AppError(409, 'history_changed', 'The conversation changed. Reload its history.')
  const costs = ids.length ? await db.select({ responseId: usageEvents.responseId, costMicros: usageEvents.costMicros,
    inferenceReferenceCostMicros: usageEvents.inferenceReferenceCostMicros, subscriptionCoveredMicros: usageEvents.weeklyCostMicros,
  }).from(usageEvents).where(inArray(usageEvents.responseId, ids)) : []
  const byResponse = new Map(costs.map(row => [row.responseId, { costMicros: Number(row.costMicros),
    inferenceReferenceCostMicros: Number(row.inferenceReferenceCostMicros), subscriptionCoveredMicros: Number(row.subscriptionCoveredMicros) }]))
  const attachmentIds = [...new Set(rows.flatMap(row => responseAttachmentIds(row.input)))]
  const attachmentRows = attachmentIds.length ? await db.select({ id: attachments.id, originalName: attachments.originalName,
    mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes,
  }).from(attachments).where(and(eq(attachments.userId, userId), eq(attachments.status, 'ready'), inArray(attachments.id, attachmentIds))) : []
  const metadata = branchMetadataIndex(graph)
  const byId = new Map(rows.map(row => [row.id, row]))
  return { history: page.history, attachments: attachmentRows,
    responses: ids.map(id => {
      const row = byId.get(id)!
      return toPublicChatResponse(row, rows, { compact: true, branches: metadata(row), usageCost: byResponse.get(row.id) })
    }),
  }
}
