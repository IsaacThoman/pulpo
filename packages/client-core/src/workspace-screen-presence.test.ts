import type { WorkspaceScreenPresence } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRESENCE_EXPIRY_GRACE_MS,
  PRESENCE_RECHECK_MIN_MS,
  WorkspaceScreenPresenceTracker,
  workspaceScreenOffer,
} from './workspace-screen-presence.js'

const MINUTE = 60_000
const live = (expiresInMs: number): WorkspaceScreenPresence => ({ live: true, expiresAt: new Date(Date.now() + expiresInMs).toISOString() })
const gone: WorkspaceScreenPresence = { live: false, expiresAt: null }

/** A fake `…/presence` route answering from a list, then repeating the last answer, and a foreground switch. */
function harness(answers: Array<WorkspaceScreenPresence | Error | (() => WorkspaceScreenPresence)>) {
  const requests: Array<{ chatId: string; signal: AbortSignal }> = []
  let foregroundListener: ((foreground: boolean) => void) | null = null
  let foreground = true
  const tracker = new WorkspaceScreenPresenceTracker({
    fetchPresence: async (chatId, signal) => {
      requests.push({ chatId, signal })
      const next = answers.length > 1 ? answers.shift()! : answers[0]!
      if (next instanceof Error) throw next
      return typeof next === 'function' ? next() : next
    },
    foreground: {
      isForeground: () => foreground,
      subscribe: (listener) => {
        foregroundListener = listener
        return () => { foregroundListener = null }
      },
    },
  })
  const notified: number[] = []
  const watch = (chatId = 'chat-1') => tracker.subscribe(chatId, () => notified.push(Date.now()))
  const setForeground = (value: boolean) => {
    foreground = value
    foregroundListener?.(value)
  }
  return { tracker, requests, notified, watch, setForeground, watchingForeground: () => foregroundListener !== null }
}

/** Lets the request and its answer settle without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(Date.parse('2026-11-20T12:00:00.000Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('workspace screen presence', () => {
  it('asks once when the chat is first watched, and shares the answer', async () => {
    const { tracker, requests, notified, watch } = harness([live(30 * MINUTE)])
    watch()
    watch()
    await settle()
    expect(requests.map((request) => request.chatId)).toEqual(['chat-1'])
    expect(tracker.get('chat-1')?.live).toBe(true)
    expect(notified).toHaveLength(2)
  })

  it('asks again a moment after the workspace is due to go, never before, and not once it is gone', async () => {
    const { tracker, requests, watch } = harness([live(10 * MINUTE), gone])
    watch()
    await settle()
    await vi.advanceTimersByTimeAsync(10 * MINUTE + PRESENCE_EXPIRY_GRACE_MS - 1)
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(requests).toHaveLength(2)
    expect(workspaceScreenOffer(tracker.get('chat-1'))).toBe('closed')
    await vi.advanceTimersByTimeAsync(24 * 60 * MINUTE)
    expect(requests).toHaveLength(2)
  })

  it('backs off when the expiry it was given has already passed here', async () => {
    const { requests, watch } = harness([live(-MINUTE)])
    watch()
    await settle()
    await vi.advanceTimersByTimeAsync(PRESENCE_RECHECK_MIN_MS)
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(PRESENCE_RECHECK_MIN_MS)
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(PRESENCE_RECHECK_MIN_MS)
    expect(requests).toHaveLength(3)
  })

  it('asks again when told something changed, replacing a request out, and moves its timer to the new expiry', async () => {
    const { tracker, requests, watch } = harness([live(5 * MINUTE), live(5 * MINUTE), live(30 * MINUTE)])
    watch()
    tracker.ask('chat-1')
    expect(requests[0]!.signal.aborted).toBe(true)
    await settle()
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    tracker.ask('chat-1')
    await settle()
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(requests).toHaveLength(3)
  })

  it('asks nothing for a chat nobody watches, and stops when the last watcher goes', async () => {
    const { tracker, requests, watch } = harness([live(MINUTE)])
    tracker.ask('chat-1')
    tracker.setBusy('chat-1', false)
    expect(requests).toEqual([])
    const stop = watch()
    await settle()
    stop()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(requests).toHaveLength(1)
  })

  it('keeps the last answer, and its expiry check, when a request fails', async () => {
    const { tracker, requests, watch } = harness([live(10 * MINUTE), new Error('offline'), gone])
    watch()
    await settle()
    tracker.ask('chat-1')
    await settle()
    expect(tracker.get('chat-1')?.live).toBe(true)
    await vi.advanceTimersByTimeAsync(10 * MINUTE + PRESENCE_EXPIRY_GRACE_MS)
    expect(requests).toHaveLength(3)
    expect(tracker.get('chat-1')).toEqual(gone)
  })

  it('forgets the answer while a reply is at work and asks again when it finishes', async () => {
    const { tracker, requests, notified, watch } = harness([gone, live(30 * MINUTE)])
    watch()
    await settle()
    expect(workspaceScreenOffer(tracker.get('chat-1'))).toBe('closed')
    tracker.ask('chat-1')
    tracker.setBusy('chat-1', true)
    // The old "gone" is forgotten, so the screen is offered, and the request out is cancelled.
    expect(workspaceScreenOffer(tracker.get('chat-1'))).toBe('open')
    expect(requests[1]!.signal.aborted).toBe(true)
    expect(notified).toHaveLength(2)
    tracker.ask('chat-1')
    expect(requests).toHaveLength(2)
    tracker.setBusy('chat-1', false)
    await settle()
    expect(requests).toHaveLength(3)
    expect(tracker.get('chat-1')?.live).toBe(true)
  })

  it('stops asking in the background and asks again on return, watching the foreground only while needed', async () => {
    const { requests, watch, setForeground, watchingForeground } = harness([live(10 * MINUTE)])
    expect(watchingForeground()).toBe(false)
    const stop = watch()
    await settle()
    setForeground(false)
    await vi.advanceTimersByTimeAsync(20 * MINUTE)
    expect(requests).toHaveLength(1)
    setForeground(true)
    await settle()
    expect(requests).toHaveLength(2)
    stop()
    expect(watchingForeground()).toBe(false)
  })

  it('keeps chats apart', async () => {
    const { tracker, requests, watch } = harness([live(MINUTE), gone])
    watch('chat-1')
    await settle()
    watch('chat-2')
    await settle()
    expect(requests.map((request) => request.chatId)).toEqual(['chat-1', 'chat-2'])
    expect(tracker.get('chat-1')?.live).toBe(true)
    expect(tracker.get('chat-2')?.live).toBe(false)
  })

  it('offers the screen until an answer says the workspace is gone', () => {
    expect(workspaceScreenOffer(undefined)).toBe('open')
    expect(workspaceScreenOffer({ live: true, expiresAt: null })).toBe('open')
    expect(workspaceScreenOffer(gone)).toBe('closed')
  })
})
