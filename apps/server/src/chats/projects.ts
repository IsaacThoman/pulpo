import { and, eq, isNull, sql } from 'drizzle-orm'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { FileProject, UpdateFileProjectInput } from '@pulpo/contracts'
import { FILE_TREE_MAX_DEPTH, PROJECT_TEXT_MAX_LENGTH } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chats, fileNodes, fileProjects, models } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { applyMemoryDocumentEdits, type MemoryDocumentEdit } from '../memory-document/service.js'

type ProjectRow = typeof fileProjects.$inferSelect
export type ChatProject = ProjectRow & { name: string }

/** The project a Files folder is in: its own, or the nearest folder above it that is one. */
export async function folderProject(userId: string, folderId: string | null): Promise<ChatProject | null> {
  if (!folderId) return null
  const rows = await db.execute<{ folder_id: string }>(sql`
    with recursive ancestors(id, parent_id, depth) as (
      select id, parent_id, 0 from file_nodes
      where id = ${folderId}::uuid and owner_user_id = ${userId}::uuid and trashed_at is null
      union all
      select node.id, node.parent_id, ancestors.depth + 1 from file_nodes node
      join ancestors on node.id = ancestors.parent_id
      where ancestors.depth < ${FILE_TREE_MAX_DEPTH} and node.trashed_at is null
    )
    select ancestors.id::text as folder_id from ancestors
    join file_projects project on project.folder_id = ancestors.id
    order by ancestors.depth limit 1
  `)
  const folder = rows[0]?.folder_id
  if (!folder) return null
  const [row] = await db.select({ project: fileProjects, name: fileNodes.name }).from(fileProjects)
    .innerJoin(fileNodes, eq(fileNodes.id, fileProjects.folderId))
    .where(and(eq(fileProjects.folderId, folder), eq(fileProjects.userId, userId))).limit(1)
  return row ? { ...row.project, name: row.name } : null
}

/**
 * The project a chat belongs to, through the folder it is filed in. Side chats and threads belong
 * to their origin chat's project.
 */
export async function chatProject(
  userId: string,
  chat: Pick<typeof chats.$inferSelect, 'kind' | 'folderId' | 'originChatId'>,
): Promise<ChatProject | null> {
  let folderId = chat.folderId
  if (chat.kind !== 'chat' && chat.originChatId) {
    const [origin] = await db.select({ folderId: chats.folderId }).from(chats)
      .where(and(eq(chats.id, chat.originChatId), eq(chats.userId, userId))).limit(1)
    folderId = origin?.folderId ?? null
  }
  return folderProject(userId, folderId)
}

export function toPublicProject(project: ChatProject): FileProject {
  return {
    folderId: project.folderId,
    name: project.name,
    instructions: project.instructions,
    memory: project.memory,
    memoryRevision: project.memoryRevision,
    threadModelId: project.threadModelId,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

async function ownedFolder(userId: string, folderId: string) {
  const [folder] = await db.select().from(fileNodes).where(and(
    eq(fileNodes.id, folderId), eq(fileNodes.ownerUserId, userId), isNull(fileNodes.trashedAt),
  )).limit(1)
  if (!folder || folder.kind !== 'folder') throw notFound('Folder')
  if (folder.systemRole) throw new AppError(400, 'project_unsupported', 'Built-in folders cannot be projects')
  return folder
}

export async function readFolderProject(userId: string, folderId: string): Promise<FileProject | null> {
  const folder = await ownedFolder(userId, folderId)
  const [row] = await db.select().from(fileProjects).where(and(eq(fileProjects.folderId, folderId), eq(fileProjects.userId, userId))).limit(1)
  return row ? toPublicProject({ ...row, name: folder.name }) : null
}

async function assertThreadModel(modelId: string | null | undefined): Promise<void> {
  if (!modelId) return
  const [model] = await db.select({ agentEnabled: models.agentEnabled }).from(models)
    .where(and(eq(models.id, modelId), eq(models.enabled, true))).limit(1)
  if (!model) throw new AppError(400, 'model_not_found', 'The selected model is unavailable')
  if (!model.agentEnabled) throw new AppError(400, 'model_not_agent_capable', 'Threads need a model that is enabled for agent mode')
}

/** Makes the folder a project, or updates it if it already is one. */
export async function upsertFolderProject(userId: string, folderId: string, input: UpdateFileProjectInput): Promise<FileProject> {
  const folder = await ownedFolder(userId, folderId)
  await assertThreadModel(input.threadModelId)
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(fileProjects).where(eq(fileProjects.folderId, folderId)).for('update').limit(1)
    if (current && current.userId !== userId) throw notFound('Folder')
    if (input.expectedMemoryRevision !== undefined && input.memory !== undefined && (current?.memoryRevision ?? 0) !== input.expectedMemoryRevision) {
      throw new AppError(409, 'project_memory_conflict', 'Project memory changed since you opened it. Reload it and try again.')
    }
    const memoryChanged = input.memory !== undefined && input.memory !== (current?.memory ?? '')
    const now = new Date()
    if (!current) {
      const [created] = await tx.insert(fileProjects).values({
        folderId,
        userId,
        instructions: input.instructions ?? '',
        memory: input.memory ?? '',
        memoryRevision: memoryChanged ? 1 : 0,
        threadModelId: input.threadModelId ?? null,
        createdAt: now,
        updatedAt: now,
      }).returning()
      return created!
    }
    const [row] = await tx.update(fileProjects).set({
      instructions: input.instructions ?? current.instructions,
      memory: input.memory ?? current.memory,
      memoryRevision: memoryChanged ? current.memoryRevision + 1 : current.memoryRevision,
      threadModelId: input.threadModelId === undefined ? current.threadModelId : input.threadModelId,
      updatedAt: now,
    }).where(eq(fileProjects.folderId, folderId)).returning()
    return row!
  })
  return toPublicProject({ ...updated, name: folder.name })
}

/** Turns the project back into a plain folder. Its chats and files stay where they are. */
export async function deleteFolderProject(userId: string, folderId: string): Promise<void> {
  await ownedFolder(userId, folderId)
  await db.delete(fileProjects).where(and(eq(fileProjects.folderId, folderId), eq(fileProjects.userId, userId)))
}

/** What every reply in a project chat is told about the project. */
export function projectContext(project: Pick<ChatProject, 'name' | 'instructions' | 'memory' | 'memoryRevision'>, options: { canEditMemory: boolean }): string {
  const sections = [
    `[Project “${project.name}”]
This chat belongs to the user's project “${project.name}”, a Files folder they set up for ongoing work. Its files are the project's library.`,
  ]
  if (project.instructions.trim()) {
    sections.push(`Project instructions, written by the user for every chat in this project:\n${project.instructions.trim()}`)
  }
  const memoryNote = options.canEditMemory
    ? 'Keep it current with update_project_memory when you learn a requirement, decision, or pitfall that later chats and threads in this project should know.'
    : 'It is kept by the agent in agent mode.'
  sections.push(project.memory.trim()
    ? `Project memory (revision ${project.memoryRevision}), notes kept for this project. ${memoryNote} Treat it as possibly stale; the user's current statements take precedence.\n${project.memory.trim()}`
    : `The project's memory is empty. ${memoryNote}`)
  sections.push('[End project]')
  return sections.join('\n\n')
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseEdit(value: unknown): MemoryDocumentEdit {
  const edit = record(value)
  if (edit.operation === 'append' && typeof edit.text === 'string') return { operation: 'append', text: edit.text }
  if (edit.operation === 'replace' && typeof edit.old_text === 'string' && typeof edit.new_text === 'string') {
    return { operation: 'replace', oldText: edit.old_text, newText: edit.new_text }
  }
  if (edit.operation === 'delete' && typeof edit.text === 'string') return { operation: 'delete', text: edit.text }
  throw new Error('Each memory edit must be a valid append, replace, or delete operation')
}

/** Lets the agent keep the project's memory: the notes every chat and thread in it starts with. */
export function createProjectMemoryTool(input: {
  userId: string
  folderId: string
  onOperationStarted?: (operationId: string) => void | Promise<void>
}): AgentTool {
  return {
    name: 'update_project_memory',
    label: 'update_project_memory',
    description: `Edit this project's memory with atomic text operations. Every chat and thread in the project starts with it, so record requirements, decisions, conventions, and pitfalls that later work should follow. Keep it concise: consolidate rather than append duplicates. Personal facts about the user belong in update_memory instead.`,
    parameters: Type.Object({
      summary: Type.String({ minLength: 1, maxLength: 240, description: 'Short user-facing description of the change.' }),
      edits: Type.Array(Type.Union([
        Type.Object({ operation: Type.Literal('append'), text: Type.String({ minLength: 1, maxLength: PROJECT_TEXT_MAX_LENGTH }) }, { additionalProperties: false }),
        Type.Object({
          operation: Type.Literal('replace'),
          old_text: Type.String({ minLength: 1, maxLength: PROJECT_TEXT_MAX_LENGTH }),
          new_text: Type.String({ maxLength: PROJECT_TEXT_MAX_LENGTH }),
        }, { additionalProperties: false }),
        Type.Object({ operation: Type.Literal('delete'), text: Type.String({ minLength: 1, maxLength: PROJECT_TEXT_MAX_LENGTH }) }, { additionalProperties: false }),
      ]), { minItems: 1, maxItems: 10 }),
    }, { additionalProperties: false }),
    executionMode: 'sequential',
    execute: async (id, rawArgs, signal) => {
      signal?.throwIfAborted()
      await input.onOperationStarted?.(id)
      const args = record(rawArgs)
      if (typeof args.summary !== 'string' || !args.summary.trim()) throw new Error('summary is required')
      if (!Array.isArray(args.edits)) throw new Error('edits must be an array')
      const edits = args.edits.map(parseEdit)
      const updated = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(fileProjects).where(and(
          eq(fileProjects.folderId, input.folderId), eq(fileProjects.userId, input.userId),
        )).for('update').limit(1)
        if (!current) throw new Error('This chat is no longer in a project')
        const memory = applyMemoryDocumentEdits(current.memory, edits)
        if (memory.length > PROJECT_TEXT_MAX_LENGTH) throw new Error(`Project memory is limited to ${PROJECT_TEXT_MAX_LENGTH} characters; consolidate it first`)
        const [row] = await tx.update(fileProjects).set({
          memory, memoryRevision: current.memoryRevision + 1, updatedAt: new Date(),
        }).where(eq(fileProjects.folderId, current.folderId)).returning()
        return row!
      })
      const summary = args.summary.replace(/\s+/g, ' ').trim().slice(0, 240)
      return {
        content: [{ type: 'text' as const, text: `Updated project memory to revision ${updated.memoryRevision}: ${summary}` }],
        details: { kind: 'project_memory_update', revision: updated.memoryRevision, summary },
      }
    },
  }
}
