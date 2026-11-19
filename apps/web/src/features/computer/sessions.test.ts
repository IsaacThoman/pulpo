import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopComputerApi } from '@pulpo/contracts'
import { ApiError } from '@/lib/api'
import {
  activeComputerSessionIds, computerResponseStatus, computerSendErrorMessage, endComputerQueued, linkComputerSessionToQueued,
  linkComputerSessionToResponse, observeComputerResponses, prepareComputerSend, relinkComputerResponse, resetComputerSessionsForTests,
  restoreComputerSessions, subscribeComputerSessions, trackComputerSession,
} from './sessions'

const project = { path: '/Users/me/project', name: 'project' }
const other = { path: '/Users/me/other', name: 'other' }

function bridge() {
  return {
    status: vi.fn(), chooseFolder: vi.fn<DesktopComputerApi['chooseFolder']>(async () => other), allowFullAccess: vi.fn(async () => true),
    begin: vi.fn<DesktopComputerApi['begin']>(async () => ({ ok: true })), end: vi.fn(async () => undefined),
    sessions: vi.fn(async () => []), handle: vi.fn(), changes: {} as DesktopComputerApi['changes'],
  }
}

let api: ReturnType<typeof bridge>
beforeEach(() => {
  resetComputerSessionsForTests()
  api = bridge()
  vi.stubGlobal('window', { pulpoDesktop: { platform: 'desktop', computer: api } })
})
afterEach(() => vi.unstubAllGlobals())

describe('preparing a send', () => {
  it('does nothing for Cloud or without the bridge', async () => {
    expect(await prepareComputerSend({ enabled: false, access: 'full', folder: null })).toEqual({ ok: true, selection: undefined })
    vi.stubGlobal('window', { pulpoDesktop: { platform: 'desktop' } })
    expect(await prepareComputerSend({ enabled: true, access: 'full', folder: null })).toEqual({ ok: true, selection: undefined })
    expect(api.begin).not.toHaveBeenCalled()
  })

  it('registers a fresh session per message and tracks it', async () => {
    const listener = vi.fn()
    subscribeComputerSessions(listener)
    const first = await prepareComputerSend({ enabled: true, access: 'suggest', folder: project })
    const second = await prepareComputerSend({ enabled: true, access: 'suggest', folder: project })
    if (!first.ok || !second.ok) throw new Error('expected ok')
    expect(first.selection).toEqual({ sessionId: expect.any(String), access: 'suggest', folder: project.path })
    expect(first.selection!.sessionId).not.toBe(second.selection!.sessionId)
    expect(api.begin).toHaveBeenCalledWith({ sessionId: first.selection!.sessionId, access: 'suggest', folder: project.path })
    expect(activeComputerSessionIds()).toEqual([first.selection!.sessionId, second.selection!.sessionId])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('asks for the folder once when it is not allowed, and uses the one picked', async () => {
    api.begin.mockResolvedValueOnce({ ok: false, reason: 'folder_not_allowed' })
    const prepared = await prepareComputerSend({ enabled: true, access: 'read', folder: project })
    expect(api.chooseFolder).toHaveBeenCalledOnce()
    expect(api.begin).toHaveBeenCalledTimes(2)
    expect(prepared).toEqual({ ok: true, selection: expect.objectContaining({ folder: other.path }), folder: other })
  })

  it('asks for full access once, and fails without sending when it is still refused', async () => {
    api.begin.mockResolvedValue({ ok: false, reason: 'full_access_not_allowed' })
    api.allowFullAccess.mockResolvedValueOnce(true)
    expect(await prepareComputerSend({ enabled: true, access: 'full', folder: null })).toEqual({ ok: false, message: "This computer isn't connected" })
    expect(api.allowFullAccess).toHaveBeenCalledOnce()
    expect(api.begin).toHaveBeenCalledTimes(2)
    expect(activeComputerSessionIds()).toEqual([])
  })

  it('fails when the prompt is declined, signed out, or the bridge throws', async () => {
    api.begin.mockResolvedValueOnce({ ok: false, reason: 'full_access_not_allowed' })
    api.allowFullAccess.mockResolvedValueOnce(false)
    expect((await prepareComputerSend({ enabled: true, access: 'full', folder: null })).ok).toBe(false)
    expect(api.begin).toHaveBeenCalledOnce()

    api.begin.mockResolvedValueOnce({ ok: false, reason: 'signed_out' })
    expect((await prepareComputerSend({ enabled: true, access: 'full', folder: null })).ok).toBe(false)
    expect(api.allowFullAccess).toHaveBeenCalledOnce()

    api.begin.mockRejectedValueOnce(new Error('ipc'))
    expect((await prepareComputerSend({ enabled: true, access: 'full', folder: null })).ok).toBe(false)
    expect(activeComputerSessionIds()).toEqual([])
  })

  it('picks a folder first when a folder mode has none, and cancelling sends nothing', async () => {
    api.chooseFolder.mockResolvedValueOnce(null)
    expect((await prepareComputerSend({ enabled: true, access: 'write', folder: null })).ok).toBe(false)
    expect(api.begin).not.toHaveBeenCalled()
    expect(await prepareComputerSend({ enabled: true, access: 'write', folder: null })).toMatchObject({ ok: true, folder: other })
  })
})

describe('session lifecycle', () => {
  it('ends a session only once its reply stops', () => {
    trackComputerSession('s1')
    linkComputerSessionToResponse('s1', 'r1')
    computerResponseStatus('r1', 'in_progress')
    computerResponseStatus('other', 'completed')
    expect(activeComputerSessionIds()).toEqual(['s1'])
    for (const status of ['completed', 'failed', 'cancelled', 'incomplete'] as const) {
      trackComputerSession(status)
      linkComputerSessionToResponse(status, `reply-${status}`)
      computerResponseStatus(`reply-${status}`, status)
      expect(activeComputerSessionIds()).not.toContain(status)
    }
    relinkComputerResponse('r1', 'r2')
    computerResponseStatus('r1', 'completed')
    expect(activeComputerSessionIds()).toEqual(['s1'])
    computerResponseStatus('r2', 'completed')
    expect(activeComputerSessionIds()).toEqual([])
    expect(api.end).toHaveBeenCalledWith('s1')
  })

  it('ends a queued message’s session when it is deleted, keeping a replacement', () => {
    trackComputerSession('old')
    trackComputerSession('new')
    linkComputerSessionToQueued('old', 'q1')
    linkComputerSessionToQueued('new', 'q1')
    endComputerQueued('q1', 'new')
    expect(activeComputerSessionIds()).toEqual(['new'])
    endComputerQueued('q1')
    expect(activeComputerSessionIds()).toEqual([])
  })

  it('keeps restored sessions with unknown links until they expire', () => {
    restoreComputerSessions(['a', 'b'])
    computerResponseStatus('a', 'completed')
    expect(activeComputerSessionIds()).toEqual(['a', 'b'])
    expect(api.end).not.toHaveBeenCalled()
  })

  it('names the unavailable computer in send errors', () => {
    expect(computerSendErrorMessage(new ApiError(409, 'computer_unavailable', 'x'))).toBe("This computer isn't connected")
    expect(computerSendErrorMessage(new ApiError(409, 'other', 'x'))).toBeNull()
  })
})

describe('replies the server lists', () => {
  it('links a queued session to the reply it became, and ends it when that reply stops', () => {
    trackComputerSession('session-1')
    linkComputerSessionToQueued('session-1', 'queued-1')
    observeComputerResponses([{ id: 'reply-1', status: 'in_progress', computerSessionId: 'session-1' }])
    // Its queued message is gone once it is dispatched; the session must outlive that.
    endComputerQueued('queued-1')
    expect(activeComputerSessionIds()).toEqual(['session-1'])
    observeComputerResponses([{ id: 'reply-1', status: 'completed', computerSessionId: 'session-1' }])
    expect(activeComputerSessionIds()).toEqual([])
    expect(api.end).toHaveBeenCalledWith('session-1')
  })

  it('ignores replies of sessions this app does not serve', () => {
    observeComputerResponses([{ id: 'reply-2', status: 'completed', computerSessionId: 'someone-elses' }, { id: 'reply-3', status: 'completed' }])
    expect(api.end).not.toHaveBeenCalled()
  })
})
