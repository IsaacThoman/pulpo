import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { WorkspaceScreenPresence } from '@pulpo/contracts'
import { fetchScreenPresence } from './api'

/**
 * Whether each chat's workspace is still there, so a reply knows whether to offer its screen. One
 * record per chat, shared by everything on the page that shows that chat: one request at a time and
 * one timer. It asks when a chat starts being shown, a moment after the workspace's expiry passes,
 * when a reply in the chat finishes and when the viewer closes; never on a fixed interval. A failed
 * request keeps the last answer.
 */

/** How long after the expiry to ask, so the server has let the workspace go by then. */
export const PRESENCE_EXPIRY_GRACE_MS = 3_000
/**
 * The soonest to ask again when the answer's expiry has already passed here (this clock runs
 * ahead of the server's, say). It doubles each time that happens in a row.
 */
export const PRESENCE_RECHECK_MIN_MS = 30_000
const PRESENCE_RECHECK_MAX_MS = 10 * 60_000
/** Browsers fire longer timers at once. */
const MAX_TIMER_MS = 2_147_483_647

interface Entry {
  presence: WorkspaceScreenPresence | null
  listeners: Set<() => void>
  /** Mounted watchers: while there are none, nothing is asked and no timer runs. */
  watchers: number
  /** A reply in the chat is at work, so nothing is asked until it finishes. */
  busy: boolean
  request: AbortController | null
  timer: ReturnType<typeof setTimeout> | null
  /** Answers in a row whose expiry had already passed here. */
  stale: number
}

const entries = new Map<string, Entry>()

function entry(chatId: string): Entry {
  let found = entries.get(chatId)
  if (!found) {
    found = { presence: null, listeners: new Set(), watchers: 0, busy: false, request: null, timer: null, stale: 0 }
    entries.set(chatId, found)
  }
  return found
}

function clearTimer(record: Entry) {
  if (record.timer !== null) clearTimeout(record.timer)
  record.timer = null
}

function schedule(chatId: string, record: Entry) {
  clearTimer(record)
  const presence = record.presence
  if (record.watchers === 0 || !presence?.live || !presence.expiresAt) return
  const expiresAt = Date.parse(presence.expiresAt)
  if (!Number.isFinite(expiresAt)) return
  const untilExpiry = expiresAt - Date.now()
  let delay = untilExpiry + PRESENCE_EXPIRY_GRACE_MS
  if (untilExpiry <= 0) {
    delay = Math.min(PRESENCE_RECHECK_MAX_MS, PRESENCE_RECHECK_MIN_MS * 2 ** record.stale)
    record.stale += 1
  } else record.stale = 0
  record.timer = setTimeout(() => { record.timer = null; ask(chatId) }, Math.min(delay, MAX_TIMER_MS))
}

function ask(chatId: string) {
  const record = entry(chatId)
  if (record.watchers === 0 || record.busy) return
  record.request?.abort()
  clearTimer(record)
  const request = new AbortController()
  record.request = request
  fetchScreenPresence(chatId, request.signal).then((presence) => {
    if (record.request !== request) return
    record.request = null
    const previous = record.presence
    if (previous?.live !== presence.live || previous?.expiresAt !== presence.expiresAt) {
      record.presence = presence
      for (const listener of record.listeners) listener()
    }
    schedule(chatId, record)
  }, () => {
    if (record.request !== request) return
    record.request = null
    // The last answer stands, and so does the check after its expiry.
    schedule(chatId, record)
  })
}

/** Asks again now, if the chat is being shown: a reply finished or the viewer closed. */
export function refreshWorkspaceScreenPresence(chatId: string): void {
  ask(chatId)
}

/** Starts watching a chat's presence; the first watcher asks. Returns how to stop. */
export function watchWorkspaceScreenPresence(chatId: string, busy: boolean): () => void {
  const record = entry(chatId)
  record.watchers += 1
  if (record.watchers === 1) {
    record.busy = busy
    record.stale = 0
    ask(chatId)
  }
  return () => {
    record.watchers -= 1
    if (record.watchers > 0) return
    clearTimer(record)
    record.request?.abort()
    record.request = null
  }
}

/** Says whether a reply in the chat is at work; when one finishes, presence is asked again. */
export function setWorkspaceScreenChatBusy(chatId: string, busy: boolean): void {
  const record = entry(chatId)
  const finished = record.busy && !busy
  record.busy = busy
  if (finished) ask(chatId)
}

export function workspaceScreenPresence(chatId: string): WorkspaceScreenPresence | null {
  return entries.get(chatId)?.presence ?? null
}

function subscribe(chatId: string, listener: () => void): () => void {
  const record = entry(chatId)
  record.listeners.add(listener)
  return () => { record.listeners.delete(listener) }
}

/**
 * The chat's last known presence, or null before the first answer. `busy`: a reply in the chat is
 * at work, so nothing is asked until it finishes.
 */
export function useWorkspaceScreenPresence(chatId: string, busy: boolean): WorkspaceScreenPresence | null {
  const busyRef = useRef(busy)
  busyRef.current = busy
  useEffect(() => watchWorkspaceScreenPresence(chatId, busyRef.current), [chatId])
  useEffect(() => { setWorkspaceScreenChatBusy(chatId, busy) }, [chatId, busy])
  return useSyncExternalStore(
    (listener) => subscribe(chatId, listener),
    () => workspaceScreenPresence(chatId),
    () => null,
  )
}

/** Forgets every chat's presence; for tests. */
export function resetWorkspaceScreenPresence(): void {
  for (const record of entries.values()) {
    clearTimer(record)
    record.request?.abort()
  }
  entries.clear()
}
