import { and, eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { chats } from '../database/schema.js'
import { chatProject, projectContext, type ChatProject } from './projects.js'
import { listThreadStates, originTranscript, threadSummary } from './threads.js'

export interface ChatGenerationContext {
  /** Text for the system prompt; empty for an ordinary chat outside a project with no threads. */
  context: string
  project: ChatProject | null
  kind: string
  /** Whether replies here may start and manage threads (agent mode only). */
  canCoordinateThreads: boolean
}

const EMPTY: ChatGenerationContext = { context: '', project: null, kind: 'chat', canCoordinateThreads: false }

function sideChatContext(title: string, transcript: string): string {
  return `[Side chat]
The user opened this side chat beside their chat “${title}” to ask something without adding to that conversation. Answer here; nothing you say reaches the main chat unless the user sends it there.
${transcript ? `The main chat up to the point this side chat was opened, for reference:\n<main_chat>\n${transcript}\n</main_chat>` : 'The main chat had no messages yet when this side chat was opened.'}
[End side chat]`
}

function threadContext(title: string): string {
  return `[Thread]
You are working in a thread: a task delegated from the user's chat “${title}”, running in the background. Nobody is watching it live, so work through the task on your own. When something is ambiguous, make a reasonable assumption and state it in your report instead of stopping to ask; stop and ask only when going on would be risky or wasteful.
Your final reply is sent back to the chat that started this thread as its report, so end with a concise, self-contained report: what you did, the results (with file names or links to anything you produced), and anything that needs the user's decision.
[End thread]`
}

async function coordinatorContext(userId: string, chatId: string): Promise<string> {
  const threads = await listThreadStates(userId, chatId)
  const open = threads.filter((thread) => thread.status !== 'resolved')
  if (!open.length) return ''
  const lines = open.map((thread) => {
    const summary = thread.latest ? threadSummary(thread.latest.output) : null
    return `- ${thread.chat.title} (thread_id: ${thread.chat.id}) — ${thread.status}${summary ? `: ${summary}` : ''}`
  })
  const resolved = threads.length - open.length
  return `[Threads]
Threads this chat started that are still open${resolved ? ` (${resolved} resolved not shown)` : ''}:
${lines.join('\n')}
Reports from threads arrive as thread updates; you don't need to poll them.
[End threads]`
}

/**
 * What a reply should know about where its chat sits: the project it is in, the chat a side chat
 * or thread came from, and the threads a coordinating chat has open.
 */
export async function loadChatGenerationContext(input: {
  userId: string
  chatId: string
  agentMode: boolean
  origin: string
}): Promise<ChatGenerationContext> {
  const [chat] = await db.select().from(chats).where(and(eq(chats.id, input.chatId), eq(chats.userId, input.userId))).limit(1)
  if (!chat) return EMPTY
  const project = chat.temporary ? null : await chatProject(input.userId, chat)
  const canCoordinateThreads = input.agentMode && chat.kind === 'chat' && !chat.temporary && input.origin === 'web'
  const sections: string[] = []
  if (project) sections.push(projectContext(project, { canEditMemory: input.agentMode && input.origin === 'web' }))
  if (chat.kind === 'side') {
    const origin = await originTranscript(chat)
    if (origin) sections.push(sideChatContext(origin.title, origin.transcript))
  } else if (chat.kind === 'thread') {
    const origin = await originTranscript({ ...chat, originResponseId: null })
    sections.push(threadContext(origin?.title ?? 'a chat'))
  } else if (canCoordinateThreads) {
    const threads = await coordinatorContext(input.userId, chat.id)
    if (threads) sections.push(threads)
  }
  return { context: sections.join('\n\n'), project, kind: chat.kind, canCoordinateThreads }
}
