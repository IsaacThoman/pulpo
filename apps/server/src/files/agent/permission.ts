import { FILES_PERMISSION_TIMEOUT_MS, filesPermissionDecisionSchema, type FilesPermissionDecision, type FilesPermissionItem } from '@pulpo/contracts'
import { redis } from '../../redis.js'

/** One item per request, numbered within the reply. */
export function filesPermissionItemId(responseId: string, ordinal: number): string {
  return `${responseId}:files-permission:${ordinal}`
}

export function filesPermissionRequest(options: {
  responseId: string
  ordinal: number
  command: string
  path: string
  agentTurn?: number
  now?: Date
  timeoutMs?: number
}): FilesPermissionItem {
  const now = options.now ?? new Date()
  return {
    id: filesPermissionItemId(options.responseId, options.ordinal),
    type: 'pulpo_files_permission',
    status: 'awaiting_decision',
    command: options.command,
    path: options.path,
    requested_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (options.timeoutMs ?? FILES_PERMISSION_TIMEOUT_MS)).toISOString(),
    ...options.agentTurn ? { agent_turn: options.agentTurn } : {},
  }
}

function decisionKey(responseId: string, itemId: string): string {
  return `pulpo:response:${responseId}:files-permission:${itemId}`
}

export interface FilesPermissionAnswers {
  read: () => Promise<string | null>
  clear: () => Promise<unknown>
}

export function redisFilesPermissionAnswers(responseId: string, itemId: string): FilesPermissionAnswers {
  const key = decisionKey(responseId, itemId)
  return { read: () => redis.get(key), clear: () => redis.del(key) }
}

/** Records the user's answer for the request `itemId`; the waiting reply picks it up. */
export async function recordFilesPermissionDecision(responseId: string, itemId: string, decision: FilesPermissionDecision): Promise<void> {
  await redis.set(decisionKey(responseId, itemId), decision, 'EX', 3_600)
}

/** Waits for the user's answer until the request expires or the run is aborted. */
export async function waitForFilesPermissionDecision(options: {
  answers: FilesPermissionAnswers
  expiresAt: Date
  signal?: AbortSignal
  pollMs?: number
}): Promise<FilesPermissionDecision | 'expired' | 'stopped'> {
  const { answers, expiresAt, signal, pollMs = 500 } = options
  while (!signal?.aborted) {
    const decision = filesPermissionDecisionSchema.safeParse(await answers.read())
    if (decision.success) {
      await answers.clear()
      return decision.data
    }
    const remaining = expiresAt.getTime() - Date.now()
    if (remaining <= 0) return 'expired'
    if (signal?.aborted) break
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, Math.min(pollMs, remaining))
      signal?.addEventListener('abort', done, { once: true })
      function done() {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        resolve()
      }
    })
  }
  return 'stopped'
}
