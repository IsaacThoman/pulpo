import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { MAX_WORKING_THREADS_PER_CHAT } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'
import { assistantOutputText } from '../responses/output-text.js'
import { listThreadStates, messageThread, setThreadResolved, startThread, threadSummary } from './threads.js'

const READ_LIMIT = 24_000

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

function text(value: string, details: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: value }], details }
}

/** Tool errors the agent can act on read as plain sentences rather than stack traces. */
async function friendly<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof AppError) throw new Error(error.message, { cause: error })
    throw error
  }
}

/**
 * Tools that let an agent-mode chat coordinate threads: separate agent sessions that work on a
 * task in the background and report back here when they stop.
 */
export function createThreadTools(input: {
  userId: string
  chatId: string
  onOperationStarted?: (operationId: string) => void | Promise<void>
}): AgentTool[] {
  const started = async (id: string, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    await input.onOperationStarted?.(id)
  }
  return [
    {
      name: 'start_thread',
      label: 'start_thread',
      description: `Start a thread: a separate agent session, with its own workspace and context window, that works on one task in the background while this conversation continues. Its final reply comes back to this chat automatically as a thread update, which you then read and act on.
Use threads for substantial, self-contained work: tasks the user wants done in parallel, or long work that would crowd this conversation (research, drafting, building or analyzing something in a workspace). Answer quick questions yourself instead. Start one thread per independent task; send follow-ups in the same area to its existing thread with message_thread rather than starting another.
A thread does not see this conversation. It starts with only your task, plus the project's instructions and memory when the chat is in a project, so write the task as a complete brief: the goal, every fact and constraint it needs, what "done" looks like, and what to include in its report. Threads work unattended, so tell it what to do when something is missing rather than expecting it to ask.
At most ${MAX_WORKING_THREADS_PER_CHAT} threads can work at once. After starting threads, tell the user briefly what each one is doing; don't wait for them or poll them.`,
      parameters: Type.Object({
        title: Type.String({ minLength: 1, maxLength: 80, description: 'Short name for the thread, shown to the user, e.g. "Compare CRM pricing".' }),
        task: Type.String({ minLength: 1, maxLength: 20_000, description: 'The complete brief the thread starts from.' }),
      }, { additionalProperties: false }),
      executionMode: 'sequential',
      execute: async (id, rawArgs, signal) => {
        await started(id, signal)
        const args = record(rawArgs)
        const title = requiredString(args, 'title')
        const task = requiredString(args, 'task')
        const { thread } = await friendly(() => startThread({ ownerUserId: input.userId, coordinatorChatId: input.chatId, title, task }))
        return text(
          `Started thread “${thread.title}” (thread_id: ${thread.id}). It works in the background; its report will arrive here as a thread update when it stops.`,
          { kind: 'thread_started', threadId: thread.id, title: thread.title },
        )
      },
    },
    {
      name: 'message_thread',
      label: 'message_thread',
      description: 'Send a follow-up instruction, correction, or answer to one of this chat\'s threads. It runs as soon as the thread is free; a resolved thread reopens. Its next report arrives here as a thread update.',
      parameters: Type.Object({
        thread_id: Type.String({ minLength: 1, description: 'The thread_id from start_thread or list_threads.' }),
        message: Type.String({ minLength: 1, maxLength: 20_000 }),
      }, { additionalProperties: false }),
      executionMode: 'sequential',
      execute: async (id, rawArgs, signal) => {
        await started(id, signal)
        const args = record(rawArgs)
        const threadId = requiredString(args, 'thread_id')
        const { queued } = await friendly(() => messageThread({
          ownerUserId: input.userId, coordinatorChatId: input.chatId, threadId, message: requiredString(args, 'message'),
        }))
        return text(
          queued ? 'Sent. The thread is still working, so it will read this when its current reply finishes.' : 'Sent. The thread is working on it now.',
          { kind: 'thread_messaged', threadId },
        )
      },
    },
    {
      name: 'list_threads',
      label: 'list_threads',
      description: 'List this chat\'s threads with their status (working, attention, done, resolved) and the start of each one\'s latest reply. Use it to answer the user\'s questions about progress; you don\'t need to poll it, because reports arrive on their own.',
      parameters: Type.Object({}, { additionalProperties: false }),
      executionMode: 'sequential',
      execute: async (id, _rawArgs, signal) => {
        await started(id, signal)
        const threads = await listThreadStates(input.userId, input.chatId)
        if (!threads.length) return text('This chat has no threads.', { kind: 'thread_list', count: 0 })
        const lines = threads.map((thread) => {
          const summary = thread.latest ? threadSummary(thread.latest.output) : null
          return `- ${thread.chat.title} (thread_id: ${thread.chat.id}) — ${thread.status}${summary ? `: ${summary}` : ''}`
        })
        return text(lines.join('\n'), { kind: 'thread_list', count: threads.length })
      },
    },
    {
      name: 'read_thread',
      label: 'read_thread',
      description: 'Read the full latest reply of one of this chat\'s threads, for when its update or summary is not enough.',
      parameters: Type.Object({
        thread_id: Type.String({ minLength: 1 }),
      }, { additionalProperties: false }),
      executionMode: 'sequential',
      execute: async (id, rawArgs, signal) => {
        await started(id, signal)
        const threadId = requiredString(record(rawArgs), 'thread_id')
        const thread = (await listThreadStates(input.userId, input.chatId)).find((candidate) => candidate.chat.id === threadId)
        if (!thread) throw new Error('No thread with that id belongs to this chat')
        const reply = thread.latest ? assistantOutputText(thread.latest.output).trim() : ''
        const body = reply.length > READ_LIMIT ? `${reply.slice(0, READ_LIMIT)}\n\n[Reply truncated]` : reply
        return text(`Thread “${thread.chat.title}” — ${thread.status}\n\n${body || '(No reply text yet.)'}`, { kind: 'thread_read', threadId })
      },
    },
    {
      name: 'resolve_thread',
      label: 'resolve_thread',
      description: 'Mark a thread done once its work needs nothing more, or reopen one. Resolving stops any reply it is still working on. Resolve threads when the user has what they needed from them, so the list stays focused on open work.',
      parameters: Type.Object({
        thread_id: Type.String({ minLength: 1 }),
        resolved: Type.Optional(Type.Boolean({ description: 'false reopens the thread. Defaults to true.' })),
      }, { additionalProperties: false }),
      executionMode: 'sequential',
      execute: async (id, rawArgs, signal) => {
        await started(id, signal)
        const args = record(rawArgs)
        const threadId = requiredString(args, 'thread_id')
        const resolved = args.resolved !== false
        const thread = await friendly(() => setThreadResolved({ userId: input.userId, coordinatorChatId: input.chatId, threadId, resolved }))
        return text(resolved ? `Resolved “${thread.title}”.` : `Reopened “${thread.title}”.`, { kind: 'thread_resolved', threadId, resolved })
      },
    },
  ]
}
