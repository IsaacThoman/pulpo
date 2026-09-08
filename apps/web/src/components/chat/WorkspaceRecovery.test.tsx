// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceWait } from '@pulpo/contracts'
const mocks = vi.hoisted(() => ({ request: vi.fn(), snapshot: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (value: unknown) => unknown) => select({ user: { id: 'owner' } }) }))
vi.mock('@/stores/chat', () => ({ useChat: { getState: () => ({ applyResponseSnapshot: mocks.snapshot }) } }))
vi.mock('@/i18n/ui', () => ({ ui: (value: string) => value }))
import { WorkspaceRecovery } from './WorkspaceRecovery'
import { WorkspacePicker } from './WorkspacePicker'
let client: QueryClient
const computer = { id: '00000000-0000-4000-8000-000000000001', name: 'MacBook', online: false, roots: [{ id: '00000000-0000-4000-8000-000000000002', path: '/projects' }] }
const wait: WorkspaceWait = { generation: 3, reason: 'unresponsive', startedAt: new Date().toISOString(), deadline: new Date(Date.now() + 900_000).toISOString(), mayHaveStarted: true, workspace: { kind: 'computer', deviceId: computer.id, rootId: computer.roots[0]!.id } }
beforeEach(() => {
  mocks.request.mockReset(); mocks.snapshot.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.request.mockImplementation(async (url: string) => url === '/api/me/computers' ? { computers: [computer] } : { responseId: 'response', workspaceWait: null })
})
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers() })
const wrap = (children: React.ReactNode) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
describe('workspace controls', () => {
  it('offers offline computers and preserves the selected working folder', async () => {
    const changed = vi.fn()
    render(wrap(<WorkspacePicker value={{ kind: 'pulpo' }} onChange={changed} />))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Workspace, Pulpo' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'MacBook · /projects · Offline' }))
    expect(changed).toHaveBeenCalledWith(wait.workspace)
  })
  it('requires explicit acknowledgment before leaving an uncertain command', async () => {
    render(wrap(<WorkspaceRecovery responseId="response" wait={wait} />))
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }))
    expect(mocks.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
    expect(screen.getByText(/old command may still run/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm switch' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/api/responses/response/workspace-recovery', { method: 'POST', body: { generation: 3, action: 'switch', workspace: { kind: 'pulpo' }, acknowledgeUnknown: true } }))
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalled())
  })
  it('keeps the current command when the user chooses to wait', async () => {
    render(wrap(<WorkspaceRecovery responseId="response" wait={wait} />))
    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/api/responses/response/workspace-recovery', expect.objectContaining({ body: expect.objectContaining({ action: 'wait', generation: 3 }) })))
  })
  it('preserves the fifteen second capacity prompt delay', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    render(wrap(<WorkspaceRecovery responseId="response" wait={{ ...wait, reason: 'capacity', startedAt: new Date(now).toISOString(), mayHaveStarted: false }} />))
    expect(screen.queryByRole('button', { name: 'Switch workspace' })).toBeNull()
    await act(async () => { vi.advanceTimersByTime(15_000) })
    expect(screen.getByRole('button', { name: 'Switch workspace' })).toBeTruthy()
  })
})
