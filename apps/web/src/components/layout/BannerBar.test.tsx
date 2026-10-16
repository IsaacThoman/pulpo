// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Banner } from '@pulpo/contracts'
import { BannerBar } from './BannerBar'

const apiRequest = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ apiRequest }))
vi.mock('@/lib/runtime', () => ({ isDesktopRuntime: () => false }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: { instanceReady: boolean }) => unknown) => select({ instanceReady: true }) }))
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  clear: () => storage.clear(),
})

function banner(id: string, overrides: Partial<Banner> = {}): Banner {
  return { id, type: 'info', content: `Banner ${id}`, dismissible: true, startsAt: null, endsAt: null, createdAt: '2026-10-01T00:00:00.000Z', ...overrides }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  apiRequest.mockReset()
})

describe('BannerBar', () => {
  it('keeps a dismissed banner hidden after remounting', async () => {
    apiRequest.mockResolvedValue({ data: [banner('a'), banner('b')] })
    const first = render(<BannerBar />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Dismiss banner' }))[0]!)
    expect(screen.queryByText('Banner a')).toBeNull()
    first.unmount()

    render(<BannerBar />)
    expect(await screen.findByText('Banner b')).toBeTruthy()
    expect(screen.queryByText('Banner a')).toBeNull()
  })

  it('shows a previously dismissed banner once it is no longer dismissible', async () => {
    localStorage.setItem('pulpo.banners.dismissed', JSON.stringify(['a']))
    apiRequest.mockResolvedValue({ data: [banner('a', { dismissible: false })] })
    render(<BannerBar />)
    expect(await screen.findByText('Banner a')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Dismiss banner' })).toBeNull()
  })
})
