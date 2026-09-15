// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import i18n from '@/i18n'

const mocks = vi.hoisted(() => ({
  request: vi.fn(), desktop: false, instanceReady: true,
  user: { id: 'viewer', role: 'user' } as { id: string; role: string } | null,
}))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('@/lib/runtime', () => ({ isDesktopRuntime: () => mocks.desktop, runtimeAccountKey: (id: string) => id }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: typeof mocks) => unknown) => select(mocks) }))

import { OnlineUserCount } from './OnlineUserCount'

let client: QueryClient
beforeEach(async () => {
  vi.useFakeTimers()
  mocks.request.mockReset().mockResolvedValue({ count: 3 })
  mocks.desktop = false
  mocks.instanceReady = true
  mocks.user = { id: 'viewer', role: 'user' }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await i18n.changeLanguage('en-US')
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.useRealTimers()
})

function mount(visible = true) {
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider><OnlineUserCount visible={visible} /></TooltipProvider>
    </QueryClientProvider>,
  )
}

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
}

describe('online user label', () => {
  it('refreshes the count every minute and stops polling after unmount', async () => {
    const view = mount()
    await settle()
    expect(screen.getByText('3 online')).toBeTruthy()
    expect(mocks.request).toHaveBeenCalledWith('/api/instance/online-count')
    mocks.request.mockResolvedValue({ count: 5 })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    await settle()
    expect(screen.getByText('5 online')).toBeTruthy()
    expect(mocks.request).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('hides loading and failed counts instead of displaying a misleading zero', async () => {
    mocks.request.mockRejectedValue(new Error('Offline'))
    const view = mount()
    expect(view.container.textContent).toBe('')
    await settle()
    expect(view.container.textContent).toBe('')
  })

  it('displays a successful zero and translates the label', async () => {
    mocks.request.mockResolvedValue({ count: 0 })
    await i18n.changeLanguage('es-ES')
    mount()
    await settle()
    expect(screen.getByText('0 en línea')).toBeTruthy()
  })

  it.each(['hidden', 'signed-out', 'pending', 'instance-not-ready'])('does not fetch while %s', async (state) => {
    if (state === 'signed-out') mocks.user = null
    if (state === 'pending') mocks.user!.role = 'pending'
    if (state === 'instance-not-ready') { mocks.desktop = true; mocks.instanceReady = false }
    const view = mount(state !== 'hidden')
    await settle()
    expect(view.container.textContent).toBe('')
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
