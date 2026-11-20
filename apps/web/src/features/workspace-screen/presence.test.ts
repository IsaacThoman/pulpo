// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRESENCE_EXPIRY_GRACE_MS,
  PRESENCE_RECHECK_MIN_MS,
  refreshWorkspaceScreenPresence,
  resetWorkspaceScreenPresence,
  setWorkspaceScreenChatBusy,
  watchWorkspaceScreenPresence,
  workspaceScreenPresence,
} from './presence'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const NOW = Date.parse('2026-11-20T12:00:00.000Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()

/** A fake server for `…/presence`: answers with whatever `answer` holds when each request arrives. */
function serve(initial: () => Response | Promise<Response>) {
  const requests: string[] = []
  const server = { answer: initial, requests }
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    requests.push(new URL(String(input), 'http://pulpo.test').pathname)
    return server.answer()
  }))
  return server
}

/** Lets the request and its answer settle without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  resetWorkspaceScreenPresence()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('workspace screen presence', () => {
  it('asks once when the chat is first shown, however many replies watch it', async () => {
    const server = serve(() => json({ live: true, expiresAt: at(10 * 60_000) }))
    const stopFirst = watchWorkspaceScreenPresence('chat-1', false)
    const stopSecond = watchWorkspaceScreenPresence('chat-1', false)
    await settle()
    expect(server.requests).toEqual(['/api/chats/chat-1/workspace-screen/presence'])
    expect(workspaceScreenPresence('chat-1')).toEqual({ live: true, expiresAt: at(10 * 60_000) })
    stopFirst()
    stopSecond()
    // Nobody is watching, so the check after the expiry never happens.
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(server.requests).toHaveLength(1)
  })

  it('asks again a moment after the expiry, and not before or on an interval', async () => {
    const server = serve(() => json({ live: true, expiresAt: at(60_000) }))
    const stop = watchWorkspaceScreenPresence('chat-1', false)
    await settle()
    expect(server.requests).toHaveLength(1)
    server.answer = () => json({ live: false, expiresAt: null })
    await vi.advanceTimersByTimeAsync(60_000 + PRESENCE_EXPIRY_GRACE_MS - 1)
    expect(server.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(server.requests).toHaveLength(2)
    expect(workspaceScreenPresence('chat-1')).toEqual({ live: false, expiresAt: null })
    // Gone, nothing is asked again by itself.
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(server.requests).toHaveLength(2)
    stop()
  })

  it('waits for a running reply, then asks when it or any later reply finishes', async () => {
    const server = serve(() => json({ live: true, expiresAt: at(10 * 60_000) }))
    const stop = watchWorkspaceScreenPresence('chat-1', true)
    await settle()
    expect(server.requests).toHaveLength(0)
    setWorkspaceScreenChatBusy('chat-1', false)
    await settle()
    expect(server.requests).toHaveLength(1)
    setWorkspaceScreenChatBusy('chat-1', false)
    setWorkspaceScreenChatBusy('chat-1', true)
    await settle()
    expect(server.requests).toHaveLength(1)
    setWorkspaceScreenChatBusy('chat-1', false)
    await settle()
    expect(server.requests).toHaveLength(2)
    stop()
  })

  it('asks again when the viewer closes, and only while the chat is shown', async () => {
    const server = serve(() => json({ live: true, expiresAt: at(60_000) }))
    const stop = watchWorkspaceScreenPresence('chat-1', false)
    await settle()
    server.answer = () => json({ live: true, expiresAt: at(5 * 60_000) })
    refreshWorkspaceScreenPresence('chat-1')
    await settle()
    expect(server.requests).toHaveLength(2)
    // The check follows the new expiry, not the old one.
    await vi.advanceTimersByTimeAsync(60_000 + PRESENCE_EXPIRY_GRACE_MS)
    expect(server.requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(server.requests).toHaveLength(3)
    stop()
    refreshWorkspaceScreenPresence('chat-1')
    await settle()
    expect(server.requests).toHaveLength(3)
  })

  it('keeps the last answer when a request fails', async () => {
    const server = serve(() => json({ live: true, expiresAt: at(60_000) }))
    const stop = watchWorkspaceScreenPresence('chat-1', false)
    await settle()
    server.answer = () => json({ error: { message: 'Down' } }, 503)
    refreshWorkspaceScreenPresence('chat-1')
    await settle()
    expect(server.requests).toHaveLength(2)
    expect(workspaceScreenPresence('chat-1')).toEqual({ live: true, expiresAt: at(60_000) })
    server.answer = () => Promise.reject(new TypeError('offline'))
    await vi.advanceTimersByTimeAsync(60_000 + PRESENCE_EXPIRY_GRACE_MS)
    expect(server.requests).toHaveLength(3)
    expect(workspaceScreenPresence('chat-1')?.live).toBe(true)
    stop()
  })

  it('backs off when the expiry it was given has already passed here', async () => {
    const server = serve(() => json({ live: true, expiresAt: at(-1_000) }))
    const stop = watchWorkspaceScreenPresence('chat-1', false)
    await settle()
    await vi.advanceTimersByTimeAsync(PRESENCE_RECHECK_MIN_MS - 1)
    expect(server.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(server.requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(PRESENCE_RECHECK_MIN_MS * 2 - 1)
    expect(server.requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(server.requests).toHaveLength(3)
    stop()
  })
})
