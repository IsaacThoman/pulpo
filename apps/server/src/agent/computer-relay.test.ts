import { describe, expect, it, vi } from 'vitest'
import { computerChangesItem, routeRelayRequests } from './computer-relay.js'

describe('routeRelayRequests', () => {
  const computer = vi.fn(async () => ({ ok: true as const, output: 'computer' }))
  const files = vi.fn(async () => ({ ok: true as const, output: 'files' }))

  it('is Files itself without a shared folder', () => {
    expect(routeRelayRequests(undefined, files)).toBe(files)
    expect(routeRelayRequests(undefined, undefined)).toBeUndefined()
  })

  it('sends `pulpo computer` to the folder relay and everything else to Files', async () => {
    const relay = routeRelayRequests(computer, files)!
    await expect(relay('op', { id: 'r1', command: 'computer:ls', args: {} })).resolves.toEqual({ ok: true, output: 'computer' })
    await expect(relay('op', { id: 'r2', command: 'ls', args: {} })).resolves.toEqual({ ok: true, output: 'files' })
    expect(computer).toHaveBeenCalledWith('op', { id: 'r1', command: 'computer:ls', args: {} }, undefined)
    expect(files).toHaveBeenCalledWith('op', { id: 'r2', command: 'ls', args: {} }, undefined)
  })

  it('still answers `pulpo files` when the chat has no Files', async () => {
    const relay = routeRelayRequests(computer, undefined)!
    await expect(relay('op', { id: 'r3', command: 'pull', args: {} })).resolves.toEqual({ ok: false, error: 'Files are not available in this chat' })
    await expect(relay('op', { id: 'r4', command: 'computer:cat', args: {} })).resolves.toEqual({ ok: true, output: 'computer' })
  })
})

it('gives the reply one stable changes item', () => {
  expect(computerChangesItem('resp-1', 'session-1', { applied: 1, suggested: 3 })).toEqual({
    type: 'pulpo_computer_changes', id: 'resp-1:computer-changes', session_id: 'session-1', applied: 1, suggested: 3,
  })
})
