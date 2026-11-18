import { z } from 'zod'

const idSchema = z.uuid()
const isoDateSchema = z.iso.datetime()

/**
 * What a chat is. A side chat is a `/btw` aside that can read its origin chat but adds nothing to
 * it; a thread is a task an agent delegated from its origin chat and runs on its own. Both are
 * listed under their origin chat rather than in the sidebar.
 */
export const chatKindSchema = z.enum(['chat', 'side', 'thread'])
export type ChatKind = z.infer<typeof chatKindSchema>

/**
 * Where a thread stands, from its latest reply: `working` while a reply runs or waits in the
 * queue, `attention` when the last reply failed, stopped, or was cut short, `done` when it
 * finished, and `resolved` once the user or the coordinating agent marked it done.
 */
export const chatThreadStatusSchema = z.enum(['working', 'attention', 'done', 'resolved'])
export type ChatThreadStatus = z.infer<typeof chatThreadStatusSchema>

/** The response `branchReason` of a turn the server started to tell a chat what its threads did. */
export const THREAD_UPDATE_BRANCH_REASON = 'thread_update'

/** The most threads one chat may have working at once. */
export const MAX_WORKING_THREADS_PER_CHAT = 6
/** The most threads one chat may start in all. */
export const MAX_THREADS_PER_CHAT = 50

export const relatedChatSchema = z.object({
  id: idSchema,
  kind: chatKindSchema,
  title: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  /** Threads only. */
  status: chatThreadStatusSchema.nullable(),
  /** Threads only: the start of the latest reply, for a status line. */
  summary: z.string().nullable(),
})
export type RelatedChat = z.infer<typeof relatedChatSchema>

/** The chats around one chat: the one it came from, and its side chats and threads. */
export const relatedChatsSchema = z.object({
  origin: z.object({ id: idSchema, kind: chatKindSchema, title: z.string(), deleted: z.boolean() }).nullable(),
  sideChats: z.array(relatedChatSchema),
  threads: z.array(relatedChatSchema),
  /** The project the chat belongs to, through its folder or the chat it came from. */
  project: z.object({ folderId: idSchema, name: z.string() }).nullable(),
})
export type RelatedChats = z.infer<typeof relatedChatsSchema>

export const createSideChatSchema = z.object({
  clientId: idSchema.optional(),
  /** The reply the side chat sees up to; the chat's active reply when absent. */
  responseId: idSchema.nullable().optional(),
})
export type CreateSideChatInput = z.infer<typeof createSideChatSchema>

export const forkChatSchema = z.object({
  clientId: idSchema.optional(),
})
export type ForkChatInput = z.infer<typeof forkChatSchema>

export const updateThreadSchema = z.object({
  resolved: z.boolean(),
})
export type UpdateThreadInput = z.infer<typeof updateThreadSchema>

/** Project instructions and memory share the account MEMORY.md limit. */
export const PROJECT_TEXT_MAX_LENGTH = 16_000

export const fileProjectSchema = z.object({
  folderId: idSchema,
  name: z.string(),
  instructions: z.string(),
  memory: z.string(),
  memoryRevision: z.number().int(),
  threadModelId: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})
export type FileProject = z.infer<typeof fileProjectSchema>

export const updateFileProjectSchema = z.object({
  instructions: z.string().max(PROJECT_TEXT_MAX_LENGTH).optional(),
  memory: z.string().max(PROJECT_TEXT_MAX_LENGTH).optional(),
  /** Rejects the write when the memory changed since this revision was read. */
  expectedMemoryRevision: z.number().int().nonnegative().optional(),
  threadModelId: z.string().min(1).nullable().optional(),
})
export type UpdateFileProjectInput = z.infer<typeof updateFileProjectSchema>
