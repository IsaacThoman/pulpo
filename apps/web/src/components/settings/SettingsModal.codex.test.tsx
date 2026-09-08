// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ refresh: vi.fn().mockResolvedValue(undefined), request: vi.fn() }))
vi.mock('@/lib/instance-features', () => ({ refreshInstanceFeatures: mocks.refresh }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), apiRequest: mocks.request }))
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true })
const { useAuth } = await import('@/stores/auth')
const { SettingsModal } = await import('./SettingsModal')
const { GeneralSection } = await import('@/pages/admin/settings/sections-general')
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.setState({ codexEnabled: false, user: null })
  mocks.request.mockImplementation(async (path: string) => path === '/api/admin/settings' ? { values: {} }
    : path === '/api/management/v1/info' ? { instance: { publicUrl: 'https://pulpo.test' } }
    : path === '/api/account/providers/codex' ? { connected: false } : {})
})
afterEach(() => { cleanup(); client.clear() })
const modal = (open = true) => <QueryClientProvider client={client}><MemoryRouter><SettingsModal open={open} onClose={() => {}} initialSection="connections" /></MemoryRouter></QueryClientProvider>

describe('Codex instance UI', () => {
  it('hides Connections when disabled and redirects an open section when disabled later', async () => {
    useAuth.setState({ codexEnabled: true })
    render(modal())
    expect(await screen.findByRole('button', { name: 'Connect Codex' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connections' })).toBeTruthy()
    await act(async () => { useAuth.setState({ codexEnabled: false }) })
    expect(screen.queryByRole('button', { name: 'Connections' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Connect Codex' })).toBeNull()
    expect(screen.getByRole('button', { name: 'General' }).className).toContain('bg-accent')
  })

  it('refreshes availability when settings reopen and never mounts disabled connection controls', async () => {
    const view = render(modal(false))
    expect(mocks.refresh).not.toHaveBeenCalled()
    view.rerender(modal())
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'Connections' })).toBeNull()
    expect(mocks.request).not.toHaveBeenCalledWith('/api/account/providers/codex')
  })

  it('keeps the admin toggle visible, defaults off, and persists opt-in', async () => {
    render(<GeneralSection />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/api/admin/settings'))
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/api/admin/settings', { method: 'PATCH', body: { codex: { enabled: true } } }))
    expect(mocks.refresh).toHaveBeenCalledWith(true)
  })
})
