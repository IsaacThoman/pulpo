import { describe, expect, it, vi, beforeEach } from 'vitest'
const fake = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./controller-http.js', () => ({ workspaceControllerRequest: fake.request }))
vi.mock('../config.js', () => ({ getConfig: () => ({ WORKSPACE_CONTROLLER_URL: 'https://controller.test', WORKSPACE_CONTROLLER_TOKEN: 'test' }) }))
vi.mock('../database/client.js', () => ({ db: {} }))
import { WorkspaceManager } from './controller.js'
beforeEach(() => fake.request.mockReset())
describe('managed operation reconciliation', () => {
  it('reads the existing operation when resuming a possibly dispatched command', async () => {
    const manager = new WorkspaceManager('response', 'chat', 'user')
    vi.spyOn(manager, 'ensureLease').mockResolvedValue('lease')
    fake.request.mockResolvedValue(Response.json({ id: 'command', status: 'completed', output: 'done', exitCode: 0 }))
    expect((await manager.execute('command', 'bash', { command: 'side effect' }, undefined, undefined, undefined, true)).output).toBe('done')
    expect(fake.request).toHaveBeenCalledWith('/v1/leases/lease/v1/operations/command', expect.objectContaining({ signal: undefined }))
    expect(fake.request.mock.calls.every(([, init]) => init.method !== 'POST')).toBe(true)
  })
  it('never provisions or repeats a missing operation after reconciliation', async () => {
    const manager = new WorkspaceManager('response', 'chat', 'user')
    const lease = vi.spyOn(manager, 'ensureLease').mockResolvedValue('lease')
    fake.request.mockResolvedValue(new Response('Missing operation', { status: 404 }))
    await expect(manager.execute('command', 'bash', { command: 'side effect' }, undefined, undefined, undefined, true)).rejects.toThrow('outcome is unknown')
    expect(lease).toHaveBeenCalledTimes(1)
    expect(fake.request).toHaveBeenCalledTimes(1)
  })
  it('does not report failed status polling as healthy', async () => {
    const manager = new WorkspaceManager('response', 'chat', 'user')
    vi.spyOn(manager, 'ensureLease').mockResolvedValue('lease')
    manager.onHeartbeat = vi.fn()
    fake.request.mockResolvedValue(new Response('Unavailable', { status: 503 }))
    await expect(manager.execute('command', 'bash', {})).rejects.toThrow('outcome is unknown')
    expect(manager.onHeartbeat).not.toHaveBeenCalled()
  })
})
