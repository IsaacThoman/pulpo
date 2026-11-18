import type { ChatKind, ChatThreadStatus, RelatedChat, RelatedChats } from '@pulpo/contracts'
import { apiRequest } from '../../api/client'
import type { ServerChat } from '../../types'

/**
 * Side chats, forks, and threads (see packages/contracts/src/threads.ts). A side chat is an aside
 * beside its chat; a thread is a task an agent delegated from its chat. Neither is listed with the
 * other chats: both are reached from the chat they came from.
 */

export { isAsideChat, isListedChat } from './chatKind'

export type ChatRelationSource = { kind?: ChatKind | null; originChatId?: string | null }

export function fetchRelatedChats(chatId: string, signal?: AbortSignal): Promise<RelatedChats> {
  return apiRequest<RelatedChats>(`/api/chats/${chatId}/related`, { signal })
}

/** Opens a side chat beside `chatId` that sees its conversation up to `responseId` (its latest reply when absent). */
export function createSideChat(chatId: string, options: { responseId?: string | null; clientId?: string } = {}): Promise<ServerChat> {
  return apiRequest<ServerChat>(`/api/chats/${chatId}/side-chats`, {
    method: 'POST',
    body: {
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.responseId ? { responseId: options.responseId } : {}),
    },
  })
}

/** Copies the conversation up to and including the reply `responseId` into a new chat. */
export function forkChat(responseId: string, options: { clientId?: string } = {}): Promise<ServerChat> {
  return apiRequest<ServerChat>(`/api/messages/${responseId}/fork`, {
    method: 'POST',
    body: options.clientId ? { clientId: options.clientId } : {},
  })
}

/** Marks a thread done, or reopens it. */
export function setThreadResolved(threadId: string, resolved: boolean): Promise<ServerChat> {
  return apiRequest<ServerChat>(`/api/chats/${threadId}/thread`, { method: 'PATCH', body: { resolved } })
}

/** The response a transcript message belongs to: a sent message's id is its response's plus `:input`. */
export function messageResponseId(messageId: string): string {
  return messageId.endsWith(':input') ? messageId.slice(0, -':input'.length) : messageId
}

/** Whether a reply has settled, so it can be forked from or asked about in a side chat. */
export function replySettled(status?: string): boolean {
  return status !== 'queued' && status !== 'streaming' && status !== 'in_progress'
}

/** What a chat that came from another one says about where it came from, or null for an ordinary chat. */
export function originLabel(chat: ChatRelationSource): string | null {
  if (chat.kind === 'side') return 'Side chat from'
  if (chat.kind === 'thread') return 'Thread from'
  if (chat.originChatId) return 'Forked from'
  return null
}

export type ThreadUpdateReport = {
  threadId: string
  title: string
  /** How the thread stopped, as the server words it: `finished`, `failed`, `was stopped`… */
  outcome: string
  body: string
}

export type ThreadUpdate = {
  heading: string
  reports: ThreadUpdateReport[]
}

const THREAD_REPORT_HEADER = /^### Thread “(.*)” ([^\n]+)\nThread id: ([0-9a-f-]{36})[ \t]*(?:\n|$)/gm

/**
 * The thread reports in a thread update's message (see threadReportText on the server):
 * `Thread update — …` then a `### Thread “<title>” <outcome>\nThread id: <uuid>\n\n<reply>` section
 * per thread. Text that is not a thread update reads as a single heading with no reports.
 */
export function parseThreadUpdate(text: string): ThreadUpdate {
  const matches = [...text.matchAll(THREAD_REPORT_HEADER)]
  const preamble = (matches[0] ? text.slice(0, matches[0].index) : text).trim()
  const heading = preamble.split(' — ')[0]?.trim() || 'Thread update'
  const reports = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? text.length
    return {
      title: match[1]!.trim() || 'Thread',
      outcome: match[2]!.trim(),
      threadId: match[3]!,
      body: text.slice(start, end).trim(),
    }
  })
  return { heading, reports }
}

export const THREAD_STATUS_LABELS: Record<ChatThreadStatus, string> = {
  working: 'Working',
  attention: 'Needs attention',
  done: 'Done',
  resolved: 'Resolved',
}

const THREAD_STATUS_ORDER: ChatThreadStatus[] = ['attention', 'working', 'done', 'resolved']

export type RelatedChatSection = { key: string; title: string; data: RelatedChat[] }

/** Threads by where they stand (those that need the user first), then side chats. */
export function relatedChatSections(related: Pick<RelatedChats, 'threads' | 'sideChats'>): RelatedChatSection[] {
  const sections: RelatedChatSection[] = []
  for (const status of THREAD_STATUS_ORDER) {
    const data = related.threads.filter((thread) => (thread.status ?? 'working') === status)
    if (data.length) sections.push({ key: `thread:${status}`, title: THREAD_STATUS_LABELS[status], data })
  }
  if (related.sideChats.length) sections.push({ key: 'side', title: 'Side chats', data: related.sideChats })
  return sections
}

function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** The entry point's label for a chat's threads and side chats, or null when it has none. */
export function relatedChatsLabel(related: Pick<RelatedChats, 'threads' | 'sideChats'> | null | undefined): string | null {
  if (!related) return null
  const parts: string[] = []
  const open = related.threads.filter((thread) => thread.status !== 'resolved')
  const working = related.threads.filter((thread) => thread.status === 'working').length
  if (related.threads.length) {
    parts.push(working
      ? `${counted(related.threads.length, 'thread')} · ${working} working`
      : open.length === related.threads.length || !open.length
        ? counted(related.threads.length, 'thread')
        : `${counted(related.threads.length, 'thread')} · ${open.length} open`)
  }
  if (related.sideChats.length) parts.push(counted(related.sideChats.length, 'side chat'))
  return parts.length ? parts.join(' · ') : null
}

export type ChatCommand = { kind: 'btw'; question: string } | { kind: 'fork' }

/** `/btw <question>` asks in a new side chat; `/fork` forks from the latest reply. */
export function parseChatCommand(input: string): ChatCommand | null {
  const trimmed = input.trim()
  const btw = /^\/btw(?:\s+([\s\S]*))?$/i.exec(trimmed)
  if (btw) return { kind: 'btw', question: (btw[1] ?? '').trim() }
  if (/^\/fork$/i.test(trimmed)) return { kind: 'fork' }
  return null
}

/** The latest settled reply in a transcript, which `/fork` and `/btw` start from. */
export function latestSettledReplyId(messages: readonly { id: string; role: string; status?: string }[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role !== 'assistant') continue
    return replySettled(message.status) ? message.id : null
  }
  return null
}
