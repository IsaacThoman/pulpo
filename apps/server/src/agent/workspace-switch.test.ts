import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ lease: null as Record<string, unknown> | null, set: vi.fn(), request: vi.fn() }))
vi.mock('../database/client.js', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => state.lease ? [state.lease] : [] }) }) }),
  update: () => ({ set: (value: unknown) => { state.set(value); return { where: async () => undefined } } }),
} }))
vi.mock('../config.js', () => ({ getConfig: () => ({ WORKSPACE_CONTROLLER_URL: 'http://controller', WORKSPACE_CONTROLLER_TOKEN: 'token' }) }))
vi.mock('./controller-http.js', () => ({ workspaceControllerRequest: state.request }))
import { releaseWorkspaceForChat } from './controller.js'
beforeEach(() => { vi.clearAllMocks(); state.request.mockResolvedValue(undefined) })
it('releases the physical sandbox before switching to a computer', async () => {
  state.lease = { id: 'lease', kind: 'sandbox', controllerLeaseId: 'cloud' }
  await releaseWorkspaceForChat('chat', { computerId: 'mac' })
  expect(state.request).toHaveBeenCalledWith('/v1/leases/cloud', expect.objectContaining({ method: 'DELETE' }))
  expect(state.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'released' }))
})
it.each([null, 'other'])('releases a computer lease when switching to %s', async (computerId) => {
  state.lease = { id: 'lease', kind: 'computer', computerId: 'mac' }
  await releaseWorkspaceForChat('chat', { computerId })
  expect(state.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'released' }))
  expect(state.request).not.toHaveBeenCalled()
})
it.each([null, 'mac'])('keeps a reusable lease for the same destination %s', async (computerId) => {
  state.lease = { id: 'lease', kind: computerId ? 'computer' : 'sandbox', computerId }
  await releaseWorkspaceForChat('chat', { computerId })
  expect(state.set).not.toHaveBeenCalled()
  expect(state.request).not.toHaveBeenCalled()
})
