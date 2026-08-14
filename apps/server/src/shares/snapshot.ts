import { and, eq, inArray } from 'drizzle-orm'
import {
  chatShareSnapshotSchema,
  type ChatShareSnapshot,
  type ChatShareSnapshotModel,
} from '@pulpo/contracts'
import { catalogIconUrls } from '../catalog/icon-service.js'
import { db } from '../database/client.js'
import {
  attachments,
  catalogIcons,
  chats,
  labs,
  models,
  providerConnections,
  responses,
} from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { responseAttachmentIds } from '../messages/input.js'
import { lineageFromLeaf } from '../messages/branching.js'
import { toSnapshot } from '../responses/service.js'
import { responseDisplayModelId } from '../chats/modelIdentity.js'

type ChatRow = typeof chats.$inferSelect
type ResponseRow = typeof responses.$inferSelect

export function outputAttachmentIds(output: unknown[]): string[] {
  return output.flatMap((item) => {
    const value = item as { type?: unknown; attachment_id?: unknown }
    return value.type === 'pulpo_attachment' && typeof value.attachment_id === 'string'
      ? [value.attachment_id]
      : []
  })
}

export function shareLineage(allTurns: ResponseRow[], activeLeafId: string | null): ResponseRow[] {
  const turns = lineageFromLeaf(allTurns, activeLeafId ?? allTurns.at(-1)?.id ?? null)
  if (turns.some((turn) => turn.status === 'queued' || turn.status === 'in_progress')) {
    throw new AppError(409, 'share_generation_in_progress', 'Wait for the active response to finish before sharing this chat')
  }
  return turns
}

export function snapshotResponses(turns: ResponseRow[]): ChatShareSnapshot['responses'] {
  return turns.map((turn) => {
    const snapshot = toSnapshot(turn)
    return {
      id: turn.id,
      modelId: turn.modelId,
      displayModelId: responseDisplayModelId(turn),
      status: snapshot.status,
      input: turn.input as unknown[],
      output: snapshot.output,
      presetSelections: turn.presetSelections as Record<string, string>,
      usage: snapshot.usage,
      error: snapshot.error,
      createdAt: turn.createdAt.toISOString(),
      completedAt: turn.completedAt?.toISOString() ?? null,
      agentMode: turn.agentMode,
    }
  })
}

async function snapshotModels(modelIds: string[]): Promise<ChatShareSnapshotModel[]> {
  if (!modelIds.length) return []
  const rows = await db.select({ model: models, lab: labs, provider: providerConnections })
    .from(models)
    .leftJoin(labs, eq(models.labId, labs.id))
    .innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id))
    .where(inArray(models.id, [...new Set(modelIds)]))
  const iconIds = [...new Set(rows.flatMap(({ model, lab }) => [model.customIconId, lab?.customIconId].filter((id): id is string => Boolean(id))))]
  const iconRows = iconIds.length ? await db.select().from(catalogIcons).where(inArray(catalogIcons.id, iconIds)) : []
  const iconById = new Map(iconRows.map((icon) => [icon.id, catalogIconUrls(icon)]))
  return rows.map(({ model, lab, provider }) => ({
    id: model.id,
    name: model.name,
    providerGroupId: lab?.id ?? 'internal',
    provider: lab?.name ?? 'Internal',
    inferenceProvider: provider.name,
    labLogo: lab?.logo ?? 'pulpo',
    modelLogo: model.logo ?? lab?.logo ?? 'pulpo',
    labCustomIcon: lab?.customIconId ? iconById.get(lab.customIconId) ?? null : null,
    modelCustomIcon: model.customIconId
      ? iconById.get(model.customIconId) ?? null
      : lab?.customIconId ? iconById.get(lab.customIconId) ?? null : null,
    iconLight: model.iconLight ?? '#18181b',
    iconDark: model.iconDark ?? '#fafafa',
  }))
}

export async function createChatShareSnapshot(input: {
  userId: string
  chat: ChatRow
  allTurns: ResponseRow[]
  sharedAt: Date
}): Promise<ChatShareSnapshot> {
  const turns = shareLineage(
    input.allTurns,
    input.chat.activeBranchLeafId ?? input.chat.activeResponseId,
  )
  const responseSnapshots = snapshotResponses(turns)
  const attachmentIds = [...new Set(turns.flatMap((turn) => [
    ...responseAttachmentIds(turn.input),
    ...outputAttachmentIds(toSnapshot(turn).output),
  ]))]
  const attachmentRows = attachmentIds.length ? await db.select({
    id: attachments.id,
    originalName: attachments.originalName,
    mimeType: attachments.mimeType,
    sizeBytes: attachments.sizeBytes,
  }).from(attachments).where(and(
    eq(attachments.userId, input.userId),
    eq(attachments.chatId, input.chat.id),
    eq(attachments.status, 'ready'),
    inArray(attachments.id, attachmentIds),
  )) : []
  const modelIds = [input.chat.modelId, ...responseSnapshots.map((response) => response.displayModelId)]
  return chatShareSnapshotSchema.parse({
    version: 1,
    sharedAt: input.sharedAt.toISOString(),
    chat: {
      id: input.chat.id,
      title: input.chat.title,
      modelId: input.chat.modelId,
      createdAt: input.chat.createdAt.toISOString(),
    },
    responses: responseSnapshots,
    attachments: attachmentRows,
    models: await snapshotModels(modelIds),
  })
}
