import type { WorkspaceScreenPresence } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRESENCE_AFTER_EXPIRY_MS,
  PRESENCE_PAST_EXPIRY_RETRY_MS,
  screenOffer,
  WorkspaceScreenPresenceTracker,
} from './presence'

const MINUTE = 60_000
const live = (expiresInMs: number): WorkspaceScreenPresence => ({ live: true, expiresAt: new Date(Date.now() + expiresInMs).toISOString() })
const gone: WorkspaceScreenPresence = { live: false, expiresAt: null }

/** A fake `…/presence` endpoint answering from a list, then repeating the last answer. */
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

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('WorkspaceScreenPresenceTracker', () => {
  it('asks once when the chat is first shown and shares the answer', async () => {
    const h = harness([live(30 * MINUTE)])
    expect(h.tracker.get('chat-1')).toBeUndefined()
    h.watch()
    h.watch()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.requests).toHaveLength(1)
    expect(h.tracker.get('chat-1')?.live).toBe(true)
    expect(h.notified).toHaveLength(2)
  })

  it('asks again a moment after the workspace is due to shut down, never before', async () => {
    const h = harness([live(30 * MINUTE), gone])
    h.watch()
    await vi.advanceTimersByTimeAsync(30 * MINUTE + PRESENCE_AFTER_EXPIRY_MS - 1)
    expect(h.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.requests).toHaveLength(2)
    expect(h.tracker.get('chat-1')).toEqual(gone)
  })

  it('does not ask on an interval once the workspace is gone', async () => {
    const h = harness([gone])
    h.watch()
    await vi.advanceTimersByTimeAsync(6 * 60 * MINUTE)
    expect(h.requests).toHaveLength(1)
  })

  it('waits a while before asking again about a workspace still called live past its expiry', async () => {
    const h = harness([live(-MINUTE), gone])
    h.watch()
    await vi.advanceTimersByTimeAsync(PRESENCE_PAST_EXPIRY_RETRY_MS - 1)
    expect(h.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.requests).toHaveLength(2)
  })

  it('asks again when told something changed, and moves its timer to the new expiry', async () => {
    const h = harness([live(10 * MINUTE), () => live(30 * MINUTE)])
    h.watch()
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    h.tracker.ask('chat-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.requests).toHaveLength(2)
    // The first expiry no longer counts.
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(h.requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(20 * MINUTE + PRESENCE_AFTER_EXPIRY_MS)
    expect(h.requests).toHaveLength(3)
  })

  it('asks nothing for a chat nobody is showing', async () => {
    const h = harness([live(30 * MINUTE)])
    h.tracker.ask('chat-1')
    const stop = h.watch()
    await vi.advanceTimersByTimeAsync(0)
    stop()
    h.tracker.ask('chat-1')
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(h.requests).toHaveLength(1)
    expect(h.watchingForeground()).toBe(false)
  })

  it('keeps the last answer when a request fails', async () => {
    const h = harness([live(30 * MINUTE), new Error('offline')])
    h.watch()
    await vi.advanceTimersByTimeAsync(0)
    const answer = h.tracker.get('chat-1')
    h.tracker.ask('chat-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.requests).toHaveLength(2)
    expect(h.tracker.get('chat-1')).toBe(answer)
    expect(h.notified).toHaveLength(1)
  })

  it('stops asking in the background and asks again on return', async () => {
    const h = harness([live(10 * MINUTE)])
    h.watch()
    await vi.advanceTimersByTimeAsync(0)
    h.setForeground(false)
    await vi.advanceTimersByTimeAsync(20 * MINUTE)
    expect(h.requests).toHaveLength(1)
    h.setForeground(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.requests).toHaveLength(2)
  })

  it('forgets the answer while a reply is at work, cancelling a request in flight', async () => {
    const h = harness([gone])
    h.watch()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.tracker.get('chat-1')).toEqual(gone)
    h.tracker.forget('chat-1')
    expect(h.tracker.get('chat-1')).toBeUndefined()
    h.tracker.ask('chat-1')
    h.tracker.forget('chat-1')
    expect(h.requests.at(-1)?.signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.tracker.get('chat-1')).toBeUndefined()
  })

  it('keeps chats apart', async () => {
    const h = harness([live(30 * MINUTE), gone])
    h.watch('chat-1')
    await vi.advanceTimersByTimeAsync(0)
    h.watch('chat-2')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.requests.map((request) => request.chatId)).toEqual(['chat-1', 'chat-2'])
    expect(h.tracker.get('chat-1')?.live).toBe(true)
    expect(h.tracker.get('chat-2')).toEqual(gone)
  })
})

describe('screenOffer', () => {
  it('offers the screen until an answer says the workspace is gone', () => {
    expect(screenOffer(undefined)).toBe('open')
    expect(screenOffer({ live: true, expiresAt: '2026-11-20T12:30:00Z' })).toBe('open')
    expect(screenOffer(gone)).toBe('closed')
  })
})
