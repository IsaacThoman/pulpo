import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPUTER_HOST_TTL_MS, type ComputerRequest, type ComputerResponse } from '@pulpo/contracts'

const fake = await vi.hoisted(async () => (await import('./test-redis.js')).createFakeRedis())
vi.mock('../redis.js', () => ({ redis: fake.redis, createRedis: fake.createRedis }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({}) }))

const { ComputerRequestError, ComputerUnavailableError, computerCall, computerConnected, pendingComputerCallCount } = await import('./tunnel.js')
const { publishComputerResponse, refreshComputerHost, releaseComputerHost } = await import('./host.js')
const { COMPUTER_REQUESTS_CHANNEL } = await import('../redis-keys.js')

const session = { userId: 'user-1', sessionId: '6f0c2a7e-1d6b-4c43-9a51-0d3c5b7f2a10' }
const description = { os: 'macos', osVersion: '15.1', arch: 'arm64', shell: 'zsh', home: '/Users/me', cwd: '/Users/me/Pulpo', attachmentsDir: '/Users/me/Pulpo/.attachments' }

let requestsSeen = 0
async function nextRequest(): Promise<ComputerRequest> {
  const index = requestsSeen
  await vi.waitFor(() => {
    expect(fake.published.filter((entry) => entry.channel === COMPUTER_REQUESTS_CHANNEL).length).toBeGreaterThan(index)
  })
  requestsSeen += 1
  const message = JSON.parse(fake.published.filter((entry) => entry.channel === COMPUTER_REQUESTS_CHANNEL)[index]!.message)
  expect(message.userId).toBe(session.userId)
  return message.request
}

const answer = (request: ComputerRequest, body: Partial<ComputerResponse> & Pick<ComputerResponse, 'ok'>, userId = session.userId) =>
  publishComputerResponse(userId, { id: request.id, sessionId: request.sessionId, ...body } as ComputerResponse)

afterEach(async () => {
  vi.useRealTimers()
  await releaseComputerHost(session.userId, 'socket-1', [session.sessionId])
  await releaseComputerHost(session.userId, 'socket-2', [session.sessionId])
  expect(pendingComputerCallCount()).toBe(0)
})

describe('computer presence', () => {
  it('tracks each hosting socket separately and forgets a claim after the TTL', async () => {
    const start = Date.now()
    expect(await computerConnected(session)).toBe(false)
    await refreshComputerHost(session.userId, 'socket-1', [session.sessionId], [], start)
    await refreshComputerHost(session.userId, 'socket-2', [session.sessionId], [], start)
    expect(await computerConnected(session)).toBe(true)
    await releaseComputerHost(session.userId, 'socket-1', [session.sessionId])
    expect(await computerConnected(session)).toBe(true)
    // A socket that stops listing the session drops its claim at once.
    await refreshComputerHost(session.userId, 'socket-2', [], [session.sessionId])
    expect(await computerConnected(session)).toBe(false)
    await refreshComputerHost(session.userId, 'socket-1', [session.sessionId], [], start - COMPUTER_HOST_TTL_MS - 1)
    expect(await computerConnected(session)).toBe(false)
  })
})

describe('computerCall', () => {
  it('publishes the request and resolves with the matching, validated answer', async () => {
    await refreshComputerHost(session.userId, 'socket-1', [session.sessionId], [])
    const call = computerCall(session, 'describe', {})
    const request = await nextRequest()
    expect(request).toMatchObject({ sessionId: session.sessionId, method: 'describe', params: {}, timeoutMs: 30_000 })
    // Answers for another request, from another user or for another session are ignored.
    await publishComputerResponse(session.userId, { id: crypto.randomUUID(), sessionId: session.sessionId, ok: true, result: description })
    await answer(request, { ok: true, result: { ...description, os: 'windows' } }, 'user-2')
    await publishComputerResponse(session.userId, { id: request.id, sessionId: crypto.randomUUID(), ok: true, result: description })
    await answer(request, { ok: true, result: description })
    await expect(call).resolves.toEqual(description)
  })

  it('turns a refusal into ComputerRequestError with its code', async () => {
    await refreshComputerHost(session.userId, 'socket-1', [session.sessionId], [])
    const call = computerCall(session, 'folder.read', { path: 'notes.txt', maxBytes: 100 })
    const request = await nextRequest()
    await answer(request, { ok: false, code: 'not_found', message: 'notes.txt does not exist' })
    await expect(call).rejects.toMatchObject({ code: 'not_found', message: 'notes.txt does not exist' })
    await expect(call).rejects.toBeInstanceOf(ComputerRequestError)
  })

  it('rejects a result that does not match the method', async () => {
    await refreshComputerHost(session.userId, 'socket-1', [session.sessionId], [])
    const call = computerCall(session, 'describe', {})
    await answer(await nextRequest(), { ok: true, result: { os: 'beos' } })
    await expect(call).rejects.toMatchObject({ code: 'failed' })
  })

  it('refuses invalid parameters before sending anything', async () => {
    const before = fake.published.length
    await expect(computerCall(session, 'folder.read', { path: 'a', maxBytes: -1 })).rejects.toMatchObject({ code: 'invalid_request' })
    expect(fake.published.length).toBe(before)
  })

  it('gives up when no answer arrives in time', async () => {
    await refreshComputerHost(session.userId, 'socket-1', [session.sessionId], [])
    const call = expect(computerCall(session, 'describe', {}, { timeoutMs: 30 })).rejects.toBeInstanceOf(ComputerUnavailableError)
    expect((await nextRequest()).timeoutMs).toBe(30)
    await call
  })

  it('waits briefly for the session to appear, then reports the computer unavailable', async () => {
    vi.useFakeTimers()
    const missing = computerCall(session, 'describe', {})
    const settled = vi.fn()
    missing.catch(settled)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_500)
    await expect(missing).rejects.toBeInstanceOf(ComputerUnavailableError)

    const late = computerCall(session, 'describe', {})
    await vi.advanceTimersByTimeAsync(2_000)
    await refreshComputerHost(session.userId, 'socket-1', [session.sessionId], [])
    await vi.advanceTimersByTimeAsync(600)
    vi.useRealTimers()
    await answer(await nextRequest(), { ok: true, result: description })
    await expect(late).resolves.toEqual(description)
  })

  it('fails a waiting call soon after the app goes away, but not while it is merely slow', async () => {
    await refreshComputerHost(session.userId, 'socket-1', [session.sessionId], [])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const slow = computerCall(session, 'operation.get', { id: 'op-1', waitMs: 10_000 }, { timeoutMs: 40_000 })
    const settled = vi.fn()
    slow.then(settled, settled)
    // Still connected: two presence checks pass and the call keeps waiting.
    await vi.advanceTimersByTimeAsync(11_000)
    expect(settled).not.toHaveBeenCalled()
    // The socket closes; the second check that finds nobody ends the call, long before its timeout.
    await releaseComputerHost(session.userId, 'socket-1', [session.sessionId])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(slow).rejects.toBeInstanceOf(ComputerUnavailableError)
    vi.useRealTimers()
    await nextRequest()
  })

  it('rejects promptly with the abort reason, while connecting or waiting for the answer', async () => {
    const connecting = new AbortController()
    const early = computerCall(session, 'describe', {}, { signal: connecting.signal })
    connecting.abort(new Error('stopped'))
    await expect(early).rejects.toThrow('stopped')

    await refreshComputerHost(session.userId, 'socket-1', [session.sessionId], [])
    const waiting = new AbortController()
    const call = computerCall(session, 'describe', {}, { signal: waiting.signal })
    const request = await nextRequest()
    waiting.abort(new Error('cancelled'))
    await expect(call).rejects.toThrow('cancelled')
    // A late answer for the abandoned request is harmless.
    await answer(request, { ok: true, result: description })

    const aborted = new AbortController()
    aborted.abort(new Error('already'))
    await expect(computerCall(session, 'describe', {}, { signal: aborted.signal })).rejects.toThrow('already')
  })
})
