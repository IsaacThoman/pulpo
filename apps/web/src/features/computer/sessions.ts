import type { ComputerFolder, ComputerSelection, ResponseStatus } from '@pulpo/contracts'
import { isComputerFolderMode } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'
import { ApiError } from '@/lib/api'
import { desktopComputerApi } from '@/lib/runtime'
import type { ComputerChoice } from './selection'

/**
 * The computer sessions this app serves, and what each waits on before it can end: the message
 * being sent, its reply, or the queued message it rides with. A session ends when its reply stops,
 * when its send fails, or when its queued message is deleted, never while the reply still runs. One
 * restored after a reload has no known link and is left to expire in the desktop app.
 */
type SessionLink =
  | { kind: 'sending' }
  | { kind: 'response'; id: string }
  | { kind: 'queued'; id: string }
  | { kind: 'unknown' }

const sessions = new Map<string, SessionLink>()
const listeners = new Set<() => void>()

function changed(): void {
  for (const listener of listeners) listener()
}

/** Sessions to announce with `computer.host`. */
export function activeComputerSessionIds(): string[] {
  return [...sessions.keys()]
}

/** Called whenever the active sessions change. */
export function subscribeComputerSessions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Sessions the desktop app still holds after a reload; their links are unknown. */
export function restoreComputerSessions(sessionIds: readonly string[]): void {
  let added = false
  for (const sessionId of sessionIds) {
    if (sessions.has(sessionId)) continue
    sessions.set(sessionId, { kind: 'unknown' })
    added = true
  }
  if (added) changed()
}

/** Forgets restored sessions the desktop app no longer holds (they expired there). */
export function pruneRestoredComputerSessions(heldIds: readonly string[]): void {
  const held = new Set(heldIds)
  let removed = false
  for (const [sessionId, link] of [...sessions]) {
    if (link.kind !== 'unknown' || held.has(sessionId)) continue
    sessions.delete(sessionId)
    removed = true
  }
  if (removed) changed()
}

export function hasRestoredComputerSessions(): boolean {
  return [...sessions.values()].some((link) => link.kind === 'unknown')
}

export function trackComputerSession(sessionId: string): void {
  sessions.set(sessionId, { kind: 'sending' })
  changed()
}

export function linkComputerSessionToResponse(sessionId: string, responseId: string): void {
  if (sessions.has(sessionId)) sessions.set(sessionId, { kind: 'response', id: responseId })
}

export function linkComputerSessionToQueued(sessionId: string, queuedMessageId: string): void {
  if (sessions.has(sessionId)) sessions.set(sessionId, { kind: 'queued', id: queuedMessageId })
}

/** The server named the reply differently from the id the app asked for. */
export function relinkComputerResponse(fromId: string, toId: string): void {
  for (const [sessionId, link] of sessions) {
    if (link.kind === 'response' && link.id === fromId) sessions.set(sessionId, { kind: 'response', id: toId })
  }
}

export function endComputerSession(sessionId: string | undefined): void {
  if (!sessionId || !sessions.delete(sessionId)) return
  changed()
  void desktopComputerApi()?.end(sessionId).catch(() => undefined)
}

function endWhere(match: (link: SessionLink, sessionId: string) => boolean): void {
  for (const [sessionId, link] of [...sessions]) if (match(link, sessionId)) endComputerSession(sessionId)
}

const TERMINAL: ReadonlySet<ResponseStatus> = new Set(['completed', 'failed', 'cancelled', 'incomplete'])

/** A reply reached a status; its session ends once the reply has stopped. */
export function computerResponseStatus(responseId: string, status: ResponseStatus): void {
  if (TERMINAL.has(status)) endWhere((link) => link.kind === 'response' && link.id === responseId)
}

/** A queued message is gone for good (deleted, or replaced by an edit with another session). */
export function endComputerQueued(queuedMessageId: string, keepSessionId?: string): void {
  endWhere((link, sessionId) => link.kind === 'queued' && link.id === queuedMessageId && sessionId !== keepSessionId)
}

/**
 * Replies the server listed with the session they use. This links a session that was waiting on a
 * queued message (or restored after a reload) to its reply, and ends it once that reply stopped.
 */
export function observeComputerResponses(responses: ReadonlyArray<{ id: string; status: ResponseStatus; computerSessionId?: string | null }>): void {
  for (const response of responses) {
    const sessionId = response.computerSessionId
    if (!sessionId || !sessions.has(sessionId)) continue
    sessions.set(sessionId, { kind: 'response', id: response.id })
    computerResponseStatus(response.id, response.status)
  }
}

/** Test hook. */
export function resetComputerSessionsForTests(): void {
  sessions.clear()
  listeners.clear()
}

export const computerUnavailableMessage = () => ui("This computer isn't connected")

/** What to show for a failed send that involved the computer; null for other failures. */
export function computerSendErrorMessage(error: unknown): string | null {
  return error instanceof ApiError && error.code === 'computer_unavailable' ? computerUnavailableMessage() : null
}

/** The error a send failed with, carrying the clear message when the computer was unavailable. */
export function withComputerSendError(error: unknown): unknown {
  const message = computerSendErrorMessage(error)
  return message ? new Error(message) : error
}

export type ComputerSendPreparation =
  | { ok: true; selection: ComputerSelection | undefined; folder?: ComputerFolder }
  | { ok: false; message: string }

/**
 * Registers a new session for one message with the desktop app, before the message is sent. When
 * the app refuses because the folder or full access is not allowed yet, it asks the user once and
 * tries again. `folder` is set when the user picked a different folder on the way.
 */
export async function prepareComputerSend(choice: ComputerChoice): Promise<ComputerSendPreparation> {
  const api = desktopComputerApi()
  if (!choice.enabled || !api) return { ok: true, selection: undefined }
  const sessionId = crypto.randomUUID()
  let folder = choice.folder
  let picked: ComputerFolder | undefined
  try {
    if (isComputerFolderMode(choice.access) && !folder) {
      folder = await api.chooseFolder()
      if (!folder) return { ok: false, message: computerUnavailableMessage() }
      picked = folder
    }
    const begin = () => api.begin({ sessionId, access: choice.access, folder: folder?.path ?? null })
    let result = await begin()
    if (!result.ok && result.reason === 'folder_not_allowed') {
      const chosen = await api.chooseFolder()
      if (chosen) {
        folder = picked = chosen
        result = await begin()
      }
    } else if (!result.ok && result.reason === 'full_access_not_allowed') {
      if (await api.allowFullAccess()) result = await begin()
    }
    if (!result.ok) return { ok: false, message: computerUnavailableMessage() }
  } catch {
    return { ok: false, message: computerUnavailableMessage() }
  }
  trackComputerSession(sessionId)
  return { ok: true, selection: { sessionId, access: choice.access, folder: folder?.path ?? null }, ...(picked ? { folder: picked } : {}) }
}
