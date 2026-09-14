import { beforeEach, expect, it, vi } from 'vitest'
const usable = vi.hoisted(() => vi.fn())
vi.mock('../agent/computer/registry.js', () => ({ assertComputerUsable: usable }))
import { resolveWorkspaceComputer } from './workspace-selection.js'
const base = { ownerUserId: 'user', requesterSessionId: 'session', computersEnabled: true, previousComputerId: 'computer-a' }
beforeEach(() => { usable.mockReset() })
it('switches from a computer to another computer or the cloud', async () => {
  expect(await resolveWorkspaceComputer({ ...base, requested: { kind: 'computer', computerId: 'computer-b' } })).toBe('computer-b')
  expect(usable).toHaveBeenCalledWith('user', 'session', 'computer-b')
  usable.mockClear()
  expect(await resolveWorkspaceComputer({ ...base, requested: { kind: 'sandbox' } })).toBeNull()
  expect(usable).not.toHaveBeenCalled()
})
it('switches from cloud to a computer and revalidates inherited computers', async () => {
  expect(await resolveWorkspaceComputer({ ...base, previousComputerId: null, requested: { kind: 'computer', computerId: 'computer-a' } })).toBe('computer-a')
  expect(await resolveWorkspaceComputer(base)).toBe('computer-a')
  expect(usable).toHaveBeenCalledTimes(2)
})
it.each([{ requesterSessionId: null }, { apiKeyId: 'key' }, { actorUserId: 'admin' }, { computersEnabled: false }])('rejects unauthorized inherited selections: %j', async (override) => {
  await expect(resolveWorkspaceComputer({ ...base, ...override })).rejects.toThrow()
  expect(usable).not.toHaveBeenCalled()
})
it('does not reroute an offline or revoked computer', async () => {
  usable.mockRejectedValue(new Error('Computer offline'))
  await expect(resolveWorkspaceComputer(base)).rejects.toThrow('Computer offline')
})
