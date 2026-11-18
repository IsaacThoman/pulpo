import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  MAX_THREADS_PER_CHAT,
  MAX_WORKING_THREADS_PER_CHAT,
  THREAD_UPDATE_BRANCH_REASON,
  truncateChatTitle,
  type ChatKind,
  type ChatThreadStatus,
  type RelatedChat,
  type RelatedChats,
} from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chats, queuedMessages, responses, users } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { lineageFromLeaf } from '../messages/branching.js'
import { responseInputText } from '../messages/input.js'
import { publishStateChange, requestCancellation } from '../responses/events.js'
import { assistantOutputText } from '../responses/output-text.js'
import { createResponse } from '../responses/service.js'
import { planDuplicateTree } from './duplicate.js'
import { accessibleChatCondition } from './temporary.js'
import { createQueuedMessage } from './message-queue.js'
import { chatProject } from './projects.js'

type ChatRow = typeof chats.$inferSelect
type ResponseRow = typeof responses.$inferSelect

/** How many threads one account may start in a day, across its chats. */
export const THREAD_STARTS_PER_DAY = 100
/**
 * How many thread updates in a row may wake a chat without the user saying anything. Past this,
 * reports wait for the user's next message, so threads and their coordinator cannot keep each other
 * going indefinitely.
 */
export const MAX_CONSECUTIVE_THREAD_UPDATES = 8
const REPORT_TEXT_LIMIT = 6_000
const SUMMARY_LIMIT = 280
const SIDE_CHAT_CONTEXT_LIMIT = 24_000

const ACTIVE_STATUSES = ['queued', 'in_progress'] as const

/** Where a thread stands, from its latest reply and whether follow-ups are waiting. */
export function deriveThreadStatus(input: {
  resolvedAt: Date | null
  latestStatus: string | null
  hasQueuedMessages: boolean
}): ChatThreadStatus {
  if (input.resolvedAt) return 'resolved'
  if (input.hasQueuedMessages || input.latestStatus === null || (ACTIVE_STATUSES as readonly string[]).includes(input.latestStatus)) return 'working'
  return input.latestStatus === 'completed' ? 'done' : 'attention'
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function threadSummary(output: unknown): string | null {
  const text = collapse(assistantOutputText(output))
  if (!text) return null
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1)}…` : text
}

/** Thread updates at the end of the branch ending at `leafId`, counted back to the last turn the user sent. */
export function consecutiveThreadUpdates(
  turns: Array<{ id: string; parentResponseId: string | null; branchReason: string }>,
  leafId: string | null,
): number {
  const byId = new Map(turns.map((turn) => [turn.id, turn]))
  const seen = new Set<string>()
  let count = 0
  let cursor = leafId
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const turn = byId.get(cursor)
    if (!turn || turn.branchReason !== THREAD_UPDATE_BRANCH_REASON) break
    count += 1
    cursor = turn.parentResponseId
  }
  return count
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

const STATUS_WORDS: Record<string, string> = {
  completed: 'finished',
  failed: 'failed',
  cancelled: 'was stopped',
  incomplete: 'stopped before finishing',
}

/**
 * The message that tells a chat what its threads did. It reads as plain text in apps that don't
 * know about threads, and as a list of thread reports in those that do.
 */
export function threadReportText(reports: Array<{ threadId: string; title: string; status: string; reply: string; error?: string | null }>): string {
  const sections = reports.map((report) => {
    const outcome = STATUS_WORDS[report.status] ?? report.status
    const body = report.reply.trim()
      ? clip(report.reply.trim(), REPORT_TEXT_LIMIT)
      : report.error ? `Error: ${clip(report.error, 500)}` : '(No reply text.)'
    return `### Thread “${report.title}” ${outcome}\nThread id: ${report.threadId}\n\n${body}`
  })
  const heading = reports.length === 1 ? 'Thread update' : `Thread updates (${reports.length})`
  return `${heading} — sent automatically when a thread you started stops working.\n\n${sections.join('\n\n')}`
}

async function bumpRevision(userId: string, chatId?: string): Promise<void> {
  const [updated] = await db.update(users)
    .set({ stateRevision: sql`${users.stateRevision} + 1` })
    .where(eq(users.id, userId))
    .returning({ revision: users.stateRevision })
  if (updated) await publishStateChange({ userId, revision: updated.revision, chatId, scopes: ['chats'] })
}

async function ownedChat(userId: string, chatId: string): Promise<ChatRow> {
  const [chat] = await db.select().from(chats).where(and(
    eq(chats.id, chatId), eq(chats.userId, userId), isNull(chats.deletedAt), accessibleChatCondition(),
  )).limit(1)
  if (!chat) throw notFound('Chat')
  return chat
}

function activeLeaf(chat: Pick<ChatRow, 'activeBranchLeafId' | 'activeResponseId'>): string | null {
  return chat.activeBranchLeafId ?? chat.activeResponseId
}

/** The latest reply of each chat's active branch. */
async function latestResponses(chatRows: ChatRow[]): Promise<Map<string, ResponseRow>> {
  const ids = chatRows.flatMap((chat) => activeLeaf(chat) ?? [])
  if (!ids.length) return new Map()
  const rows = await db.select().from(responses).where(and(inArray(responses.id, ids), isNull(responses.deletedAt)))
  return new Map(rows.map((row) => [row.chatId, row]))
}

async function chatsWithQueuedMessages(chatIds: string[]): Promise<Set<string>> {
  if (!chatIds.length) return new Set()
  const rows = await db.selectDistinct({ chatId: queuedMessages.chatId }).from(queuedMessages)
    .where(and(inArray(queuedMessages.chatId, chatIds), inArray(queuedMessages.status, ['pending', 'dispatching'])))
  return new Set(rows.map((row) => row.chatId))
}

export interface ThreadState {
  chat: ChatRow
  status: ChatThreadStatus
  latest: ResponseRow | null
}

/** The chat's live threads, oldest first, with where each stands. */
export async function listThreadStates(userId: string, chatId: string): Promise<ThreadState[]> {
  const threads = await db.select().from(chats).where(and(
    eq(chats.userId, userId), eq(chats.originChatId, chatId), eq(chats.kind, 'thread'), isNull(chats.deletedAt),
  )).orderBy(asc(chats.createdAt), asc(chats.id))
  const latest = await latestResponses(threads)
  const queued = await chatsWithQueuedMessages(threads.map((thread) => thread.id))
  return threads.map((chat) => {
    const response = latest.get(chat.id) ?? null
    return {
      chat,
      latest: response,
      status: deriveThreadStatus({ resolvedAt: chat.threadResolvedAt, latestStatus: response?.status ?? null, hasQueuedMessages: queued.has(chat.id) }),
    }
  })
}

function relatedChat(chat: ChatRow, status: ChatThreadStatus | null, latest: ResponseRow | null): RelatedChat {
  return {
    id: chat.id,
    kind: chat.kind as ChatKind,
    title: chat.title,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
    status,
    summary: chat.kind === 'thread' && latest ? threadSummary(latest.output) : null,
  }
}

export async function listRelatedChats(userId: string, chatId: string): Promise<RelatedChats> {
  const chat = await ownedChat(userId, chatId)
  const [origin] = chat.originChatId
    ? await db.select({ id: chats.id, kind: chats.kind, title: chats.title, deletedAt: chats.deletedAt }).from(chats)
      .where(and(eq(chats.id, chat.originChatId), eq(chats.userId, userId), isNull(chats.purgeStartedAt))).limit(1)
    : []
  const sideChats = await db.select().from(chats).where(and(
    eq(chats.userId, userId), eq(chats.originChatId, chatId), eq(chats.kind, 'side'), isNull(chats.deletedAt),
  )).orderBy(desc(chats.updatedAt))
  const threads = await listThreadStates(userId, chatId)
  const project = await chatProject(userId, chat)
  return {
    origin: origin ? { id: origin.id, kind: origin.kind as ChatKind, title: origin.title, deleted: origin.deletedAt !== null } : null,
    sideChats: sideChats.map((side) => relatedChat(side, null, null)),
    threads: threads.map((thread) => relatedChat(thread.chat, thread.status, thread.latest)),
    project: project ? { folderId: project.folderId, name: project.name } : null,
  }
}

/** Opens a side chat beside `chatId` that sees the conversation up to `responseId`. */
export async function createSideChat(input: { userId: string; chatId: string; responseId?: string | null; clientId?: string }): Promise<ChatRow> {
  const origin = await ownedChat(input.userId, input.chatId)
  if (origin.kind !== 'chat') throw new AppError(400, 'side_chat_unsupported', 'Side chats can only be opened from an ordinary chat')
  if (origin.temporary) throw new AppError(400, 'side_chat_unsupported', 'Temporary chats cannot have side chats')
  const originResponseId = input.responseId ?? activeLeaf(origin)
  if (originResponseId) {
    const [response] = await db.select({ id: responses.id }).from(responses).where(and(
      eq(responses.id, originResponseId), eq(responses.chatId, origin.id), isNull(responses.deletedAt),
    )).limit(1)
    if (!response) throw notFound('Message')
  }
  if (input.clientId) {
    const [existing] = await db.select().from(chats).where(eq(chats.id, input.clientId)).limit(1)
    if (existing) {
      if (existing.userId !== input.userId || existing.originChatId !== origin.id) throw new AppError(409, 'chat_id_conflict', 'Chat id is already in use')
      return existing
    }
  }
  const now = new Date()
  const [created] = await db.insert(chats).values({
    id: input.clientId ?? newId(),
    userId: input.userId,
    title: 'New chat',
    modelId: origin.modelId,
    kind: 'side',
    originChatId: origin.id,
    originResponseId,
    fileScopeIds: origin.fileScopeIds,
    fileScopeAccess: origin.fileScopeAccess,
    fileChangeMode: origin.fileChangeMode,
    createdAt: now,
    updatedAt: now,
  }).returning()
  await bumpRevision(input.userId, origin.id)
  return created!
}

/** Copies the conversation up to and including `responseId` into a new chat beside its own. */
export async function forkChat(input: { userId: string; responseId: string; clientId?: string }): Promise<ChatRow> {
  const [anchor] = await db.select().from(responses).where(and(
    eq(responses.id, input.responseId), eq(responses.userId, input.userId), isNull(responses.deletedAt),
  )).limit(1)
  if (!anchor) throw notFound('Message')
  const source = await ownedChat(input.userId, anchor.chatId)
  if (source.temporary) throw new AppError(400, 'fork_unsupported', 'Save this temporary chat before forking it')
  if ((ACTIVE_STATUSES as readonly string[]).includes(anchor.status)) {
    throw new AppError(409, 'fork_in_progress', 'Wait for this reply to finish before forking from it')
  }
  if (input.clientId) {
    const [existing] = await db.select().from(chats).where(eq(chats.id, input.clientId)).limit(1)
    if (existing) {
      if (existing.userId !== input.userId || existing.originChatId !== source.id) throw new AppError(409, 'chat_id_conflict', 'Chat id is already in use')
      return existing
    }
  }
  const turns = await db.select().from(responses).where(and(eq(responses.chatId, source.id), isNull(responses.deletedAt)))
    .orderBy(asc(responses.createdAt), asc(responses.id))
  const lineage = lineageFromLeaf(turns, anchor.id)
  const plan = planDuplicateTree(lineage, newId)
  const chatId = input.clientId ?? newId()
  const leafId = plan.responseIds.get(anchor.id) ?? null
  const now = new Date()
  const title = truncateChatTitle(source.title.endsWith(' (fork)') ? source.title : `${source.title} (fork)`)
  const created = await db.transaction(async (tx) => {
    const [chat] = await tx.insert(chats).values({
      id: chatId,
      userId: input.userId,
      folderId: source.kind === 'chat' ? source.folderId : null,
      inFilesRoot: source.kind === 'chat' ? source.inFilesRoot : false,
      title,
      modelId: source.modelId,
      sortOrder: source.sortOrder,
      fileScopeIds: source.fileScopeIds,
      fileScopeAccess: source.fileScopeAccess,
      fileChangeMode: source.fileChangeMode,
      // A fork is a chat of its own; it only remembers where it came from.
      kind: 'chat',
      originChatId: source.id,
      originResponseId: anchor.id,
      activeResponseId: leafId,
      activeBranchLeafId: leafId,
      createdAt: now,
      updatedAt: now,
    }).returning()
    for (const response of lineage) {
      await tx.insert(responses).values({
        ...response,
        ...plan.remap(response),
        workspaceScopeId: newId(),
        chatId,
        openaiResponseId: null,
        idempotencyKey: null,
        updatedAt: now,
      })
    }
    return chat!
  })
  await bumpRevision(input.userId, chatId)
  return created
}

/** What the coordinating chat's latest reply ran with, for the replies it starts elsewhere. */
async function dispatchSettings(chat: ChatRow): Promise<{ modelId: string; presetSelections: Record<string, string>; agentMode: boolean; timeZone?: string }> {
  const leaf = activeLeaf(chat)
  const [latest] = leaf ? await db.select().from(responses).where(eq(responses.id, leaf)).limit(1) : []
  return {
    modelId: latest?.modelId ?? chat.modelId,
    presetSelections: (latest?.presetSelections ?? {}) as Record<string, string>,
    agentMode: latest?.agentMode ?? false,
    timeZone: latest?.timeZone ?? undefined,
  }
}

/** Starts a reply, retrying without preset choices a redirected model no longer offers. */
async function startReply(options: Parameters<typeof createResponse>[0]): Promise<ResponseRow> {
  try {
    return await createResponse(options)
  } catch (error) {
    if (!(error instanceof AppError) || !Object.keys(options.input.presetSelections).length) throw error
    if (!['model_not_found', 'conflicting_model_redirects', 'preset_redirect_cycle'].includes(error.code)) throw error
    return createResponse({ ...options, input: { ...options.input, presetSelections: {} } })
  }
}

export interface StartThreadInput {
  ownerUserId: string
  coordinatorChatId: string
  title: string
  task: string
}

/** Starts a thread for `task` from the coordinating chat and returns it once its first reply is queued. */
export async function startThread(input: StartThreadInput): Promise<{ thread: ChatRow; responseId: string }> {
  const coordinator = await ownedChat(input.ownerUserId, input.coordinatorChatId)
  if (coordinator.kind !== 'chat' || coordinator.temporary) {
    throw new AppError(400, 'threads_unsupported', 'Only saved, ordinary chats can start threads')
  }
  const threads = await listThreadStates(input.ownerUserId, coordinator.id)
  if (threads.length >= MAX_THREADS_PER_CHAT) {
    throw new AppError(429, 'thread_limit', `This chat already has ${MAX_THREADS_PER_CHAT} threads. Send follow-ups to an existing thread instead.`)
  }
  const working = threads.filter((thread) => thread.status === 'working').length
  if (working >= MAX_WORKING_THREADS_PER_CHAT) {
    throw new AppError(429, 'thread_limit', `${working} threads are already working. Wait for one to finish, or send this to an existing thread.`)
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [today] = await db.select({ count: sql<number>`count(*)::int` }).from(chats).where(and(
    eq(chats.userId, input.ownerUserId), eq(chats.kind, 'thread'), gt(chats.createdAt, since),
  ))
  if ((today?.count ?? 0) >= THREAD_STARTS_PER_DAY) {
    throw new AppError(429, 'thread_limit', `Threads are limited to ${THREAD_STARTS_PER_DAY} a day. Try again later.`)
  }
  const task = input.task.trim()
  if (!task) throw new AppError(400, 'validation_error', 'A thread needs a task')
  const settings = await dispatchSettings(coordinator)
  const project = await chatProject(input.ownerUserId, coordinator)
  const threadModelId = project?.threadModelId ?? null
  const now = new Date()
  const [thread] = await db.insert(chats).values({
    id: newId(),
    userId: input.ownerUserId,
    title: truncateChatTitle(input.title) || 'Thread',
    modelId: threadModelId ?? coordinator.modelId,
    kind: 'thread',
    originChatId: coordinator.id,
    originResponseId: activeLeaf(coordinator),
    fileScopeIds: coordinator.fileScopeIds,
    fileScopeAccess: coordinator.fileScopeAccess,
    fileChangeMode: coordinator.fileChangeMode,
    createdAt: now,
    updatedAt: now,
  }).returning()
  let response: ResponseRow
  try {
    response = await startReply({
      ownerUserId: input.ownerUserId,
      chatId: thread!.id,
      parentResponseId: null,
      input: {
        input: task,
        modelId: threadModelId ?? settings.modelId,
        presetSelections: threadModelId ? {} : settings.presetSelections,
        attachmentIds: [],
        agentMode: true,
        timeZone: settings.timeZone,
      },
    })
  } catch (error) {
    await db.delete(chats).where(eq(chats.id, thread!.id))
    throw error
  }
  await bumpRevision(input.ownerUserId, coordinator.id)
  return { thread: thread!, responseId: response.id }
}

async function ownedThread(userId: string, coordinatorChatId: string | null, threadId: string): Promise<ChatRow> {
  const [thread] = await db.select().from(chats).where(and(
    eq(chats.id, threadId), eq(chats.userId, userId), eq(chats.kind, 'thread'), isNull(chats.deletedAt),
    coordinatorChatId ? eq(chats.originChatId, coordinatorChatId) : undefined,
  )).limit(1)
  if (!thread) throw new AppError(404, 'not_found', 'No thread with that id belongs to this chat')
  return thread
}

/**
 * Sends a follow-up to a thread. It runs next if the thread is idle, or after the thread's current
 * reply otherwise. Sending work to a resolved thread reopens it.
 */
export async function messageThread(input: { ownerUserId: string; coordinatorChatId: string; threadId: string; message: string }): Promise<{ queued: boolean }> {
  const thread = await ownedThread(input.ownerUserId, input.coordinatorChatId, input.threadId)
  const message = input.message.trim()
  if (!message) throw new AppError(400, 'validation_error', 'A message is required')
  const [running] = await db.select({ id: responses.id }).from(responses).where(and(
    eq(responses.chatId, thread.id), inArray(responses.status, [...ACTIVE_STATUSES]), isNull(responses.deletedAt),
  )).limit(1)
  const settings = await dispatchSettings(thread)
  if (thread.threadResolvedAt) await db.update(chats).set({ threadResolvedAt: null }).where(eq(chats.id, thread.id))
  await createQueuedMessage(input.ownerUserId, thread.id, {
    input: message,
    modelId: settings.modelId,
    presetSelections: settings.presetSelections,
    attachmentIds: [],
    agentMode: true,
    timeZone: settings.timeZone,
  })
  await bumpRevision(input.ownerUserId, input.coordinatorChatId)
  return { queued: Boolean(running) }
}

/** Marks a thread done, or reopens it. Resolving stops a reply it is still working on. */
export async function setThreadResolved(input: { userId: string; threadId: string; coordinatorChatId?: string | null; resolved: boolean }): Promise<ChatRow> {
  const thread = await ownedThread(input.userId, input.coordinatorChatId ?? null, input.threadId)
  const [updated] = await db.update(chats).set({
    threadResolvedAt: input.resolved ? thread.threadResolvedAt ?? new Date() : null,
    // A resolved thread has nothing left to report.
    threadReportResponseId: input.resolved ? null : thread.threadReportResponseId,
    updatedAt: new Date(),
  }).where(eq(chats.id, thread.id)).returning()
  if (input.resolved) {
    const running = await db.select({ id: responses.id }).from(responses).where(and(
      eq(responses.chatId, thread.id), inArray(responses.status, [...ACTIVE_STATUSES]), isNull(responses.deletedAt),
    ))
    for (const response of running) await requestCancellation(response.id)
    await db.delete(queuedMessages).where(eq(queuedMessages.chatId, thread.id))
  }
  await bumpRevision(input.userId, thread.originChatId ?? undefined)
  return updated!
}

/**
 * Called once a reply has settled and the chat's message queue has moved on. A thread with nothing
 * left to do records the reply for its coordinator, and any chat that just went idle hears from its
 * threads.
 */
export async function handleSettledResponse(responseId: string): Promise<void> {
  const [row] = await db.select({ chat: chats, status: responses.status }).from(responses)
    .innerJoin(chats, eq(chats.id, responses.chatId)).where(eq(responses.id, responseId)).limit(1)
  if (!row || row.chat.deletedAt) return
  const { chat } = row
  if (chat.kind === 'thread' && chat.originChatId) {
    const [busy] = await db.select({ id: responses.id }).from(responses).where(and(
      eq(responses.chatId, chat.id), inArray(responses.status, [...ACTIVE_STATUSES]), isNull(responses.deletedAt),
    )).limit(1)
    const queued = await chatsWithQueuedMessages([chat.id])
    // A follow-up is already running; its reply is the one worth reporting.
    if (busy || queued.has(chat.id)) return
    // Only the reply the thread shows is reported; a stale branch settling later is not news.
    if (activeLeaf(chat) !== responseId || chat.threadResolvedAt) {
      await bumpRevision(chat.userId, chat.originChatId)
      return
    }
    await db.update(chats).set({ threadReportResponseId: responseId }).where(eq(chats.id, chat.id))
    await bumpRevision(chat.userId, chat.originChatId)
    await deliverThreadReports(chat.originChatId)
    return
  }
  if (chat.kind === 'chat') await deliverThreadReports(chat.id)
}

/**
 * Tells an idle chat what its threads reported since it last heard from them, as a new turn the
 * chat answers like any other. Waits while the chat is replying or has queued messages: those
 * settle first, and this runs again when they do.
 */
export async function deliverThreadReports(chatId: string): Promise<void> {
  const claim = await db.transaction(async (tx) => {
    // Shares the message queue's lock, so a report and a queued message never start together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-message-queue:${chatId}`}))`)
    const [chat] = await tx.select().from(chats).where(and(
      eq(chats.id, chatId), eq(chats.kind, 'chat'), isNull(chats.deletedAt), isNull(chats.purgeStartedAt), accessibleChatCondition(),
    )).limit(1)
    if (!chat) return null
    const [active] = await tx.select({ id: responses.id }).from(responses).where(and(
      eq(responses.chatId, chatId), inArray(responses.status, [...ACTIVE_STATUSES]), isNull(responses.deletedAt),
    )).limit(1)
    if (active) return null
    const [queued] = await tx.select({ id: queuedMessages.id }).from(queuedMessages).where(and(
      eq(queuedMessages.chatId, chatId), inArray(queuedMessages.status, ['pending', 'dispatching']),
    )).limit(1)
    if (queued) return null
    const pending = await tx.select().from(chats).where(and(
      eq(chats.originChatId, chatId), eq(chats.kind, 'thread'), isNull(chats.deletedAt), isNotNull(chats.threadReportResponseId),
    )).orderBy(asc(chats.updatedAt))
    if (!pending.length) return null
    const turns = await tx.select({ id: responses.id, parentResponseId: responses.parentResponseId, branchReason: responses.branchReason })
      .from(responses).where(and(eq(responses.chatId, chatId), isNull(responses.deletedAt)))
    if (consecutiveThreadUpdates(turns, activeLeaf(chat)) >= MAX_CONSECUTIVE_THREAD_UPDATES) return null
    await tx.update(chats).set({ threadReportResponseId: null })
      .where(inArray(chats.id, pending.map((thread) => thread.id)))
    return { chat, pending }
  })
  if (!claim) return
  const reportIds = claim.pending.map((thread) => thread.threadReportResponseId!)
  const replies = await db.select().from(responses).where(inArray(responses.id, reportIds))
  const repliesById = new Map(replies.map((reply) => [reply.id, reply]))
  const text = threadReportText(claim.pending.map((thread) => {
    const reply = repliesById.get(thread.threadReportResponseId!)
    const error = reply?.error && typeof reply.error === 'object' && 'message' in reply.error ? String((reply.error as { message: unknown }).message) : null
    return {
      threadId: thread.id,
      title: thread.title,
      status: reply?.status ?? 'completed',
      reply: reply ? assistantOutputText(reply.output) : '',
      error,
    }
  }))
  const settings = await dispatchSettings(claim.chat)
  try {
    await startReply({
      ownerUserId: claim.chat.userId,
      chatId,
      branchReason: THREAD_UPDATE_BRANCH_REASON,
      input: {
        input: text,
        modelId: settings.modelId,
        presetSelections: settings.presetSelections,
        attachmentIds: [],
        agentMode: settings.agentMode,
        timeZone: settings.timeZone,
      },
    })
  } catch (error) {
    // Keep the reports for the next time this chat goes idle.
    for (const thread of claim.pending) {
      await db.update(chats).set({ threadReportResponseId: thread.threadReportResponseId })
        .where(and(eq(chats.id, thread.id), isNull(chats.threadReportResponseId)))
    }
    console.warn(JSON.stringify({
      level: 'warn', service: 'pulpo-worker', event: 'threads.report_delivery_failed', chatId,
      error: error instanceof Error ? error.message : String(error),
    }))
  }
  await bumpRevision(claim.chat.userId, chatId)
}

/** Text of a conversation's turns, newest kept when it runs long. */
export function conversationTranscript(turns: Array<{ input: unknown; output: unknown }>, limit = SIDE_CHAT_CONTEXT_LIMIT): string {
  const parts = turns.flatMap((turn) => {
    const user = responseInputText(turn.input).trim()
    const assistant = assistantOutputText(turn.output).trim()
    return [user ? `User: ${user}` : '', assistant ? `Assistant: ${assistant}` : ''].filter(Boolean)
  })
  let text = parts.join('\n\n')
  if (text.length > limit) text = `[Earlier messages omitted]\n\n…${text.slice(text.length - limit)}`
  return text
}

/** The origin chat's conversation up to the point a side chat or thread started from it. */
export async function originTranscript(chat: Pick<ChatRow, 'userId' | 'originChatId' | 'originResponseId'>): Promise<{ title: string; transcript: string } | null> {
  if (!chat.originChatId) return null
  const [origin] = await db.select({ title: chats.title }).from(chats)
    .where(and(eq(chats.id, chat.originChatId), eq(chats.userId, chat.userId), isNull(chats.purgeStartedAt))).limit(1)
  if (!origin) return null
  if (!chat.originResponseId) return { title: origin.title, transcript: '' }
  const turns = await db.select().from(responses).where(and(eq(responses.chatId, chat.originChatId), isNull(responses.deletedAt)))
    .orderBy(asc(responses.createdAt), asc(responses.id))
  return { title: origin.title, transcript: conversationTranscript(lineageFromLeaf(turns, chat.originResponseId)) }
}

/** Side chats and threads go wherever their origin chat goes: into the trash, back out, or away. */
export async function relatedChatIds(userId: string, chatIds: string[]): Promise<string[]> {
  if (!chatIds.length) return []
  const rows = await db.select({ id: chats.id }).from(chats).where(and(
    eq(chats.userId, userId), inArray(chats.originChatId, chatIds), inArray(chats.kind, ['side', 'thread']),
  ))
  return rows.map((row) => row.id)
}

/** Delivers reports a worker restart left waiting, for chats that are idle now. */
export async function recoverThreadReports(): Promise<void> {
  const rows = await db.selectDistinct({ chatId: chats.originChatId }).from(chats).where(and(
    eq(chats.kind, 'thread'), isNull(chats.deletedAt), isNotNull(chats.threadReportResponseId),
  ))
  for (const row of rows) {
    if (!row.chatId) continue
    await deliverThreadReports(row.chatId).catch((error: unknown) => {
      console.error(JSON.stringify({
        level: 'error', service: 'pulpo-worker', event: 'threads.recovery_failed', chatId: row.chatId,
        error: error instanceof Error ? error.message : String(error),
      }))
    })
  }
}
