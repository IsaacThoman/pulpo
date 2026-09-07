// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { DesktopActionsTitleBarSlot, DesktopModelTitleBarSlot } from '@/components/desktop/DesktopSidebarTitleBar'
import { useDesktopChrome } from '@/stores/desktopChrome'

vi.mock('@/stores/chat', () => ({ useChat: { getState: () => ({ abandonTemporaryChat: vi.fn() }) } }))
vi.mock('@/stores/settings', () => ({
  useSettings: (select: (state: { doubleShiftSearch: boolean; animationSpeed: number }) => unknown) =>
    select({ doubleShiftSearch: false, animationSpeed: 1 }),
}))
vi.mock('@/features/chat/ChatDataBridge', () => ({ ChatDataBridge: () => null }))
vi.mock('@/features/settings/SettingsBridge', () => ({ SettingsBridge: () => null }))
vi.mock('./BannerBar', () => ({ BannerBar: () => null }))
vi.mock('./Sidebar', () => ({
  Sidebar: ({ mobile, mobileOpen, collapsed, onToggle, onNavigate }: {
    mobile: boolean; mobileOpen: boolean; collapsed: boolean; onToggle: () => void; onNavigate: () => void
  }) => <aside data-mobile={mobile} data-collapsed={collapsed} aria-hidden={mobile && !mobileOpen}>
    <button onClick={onToggle}>Toggle sidebar</button>
    <button onClick={onNavigate}>Navigate</button>
  </aside>,
}))

let narrow = false
let resize: () => void
beforeEach(() => {
  narrow = false
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({
    get matches() { return narrow },
    addEventListener: (_: string, listener: () => void) => { resize = listener },
    removeEventListener: vi.fn(),
  })) })
  Object.defineProperty(window, 'pulpoDesktop', { configurable: true, value: { os: 'darwin' } })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'pulpoDesktop')
})

function ChatControls() {
  const desktop = useDesktopChrome((state) => state.desktopSidebarVisible)
  return desktop ? <>
    <DesktopModelTitleBarSlot><button>Model picker</button></DesktopModelTitleBarSlot>
    <DesktopActionsTitleBarSlot><button>Chat action</button></DesktopActionsTitleBarSlot>
  </> : <header><button>Model picker</button><button>Chat action</button></header>
}
function mount() {
  return render(<MemoryRouter><Routes><Route element={<AppLayout />}>
    <Route index element={<ChatControls />} />
  </Route></Routes></MemoryRouter>)
}

describe('narrow desktop layout', () => {
  it('keeps title bar controls mounted across the mobile breakpoint', () => {
    const view = mount()
    const model = screen.getByRole('button', { name: 'Model picker' })
    act(() => { narrow = true; resize() })
    expect(model.parentElement?.id).toBe('desktop-model-titlebar-slot')
    expect(screen.getByRole('button', { name: 'Model picker' })).toBe(model)
    expect(screen.getByRole('button', { name: 'Chat action' }).parentElement?.id).toBe('desktop-actions-titlebar-slot')
    expect(view.container.querySelector('.desktop-sidebar-titlebar')?.getAttribute('data-collapsed')).toBe('true')
    expect(view.container.querySelector('aside')?.getAttribute('data-mobile')).toBe('true')
    act(() => { narrow = false; resize() })
    expect(screen.getByRole('button', { name: 'Model picker' })).toBe(model)
    expect(view.container.querySelector('aside')?.getAttribute('data-mobile')).toBe('false')
  })

  it('opens and dismisses the compact sidebar using buttons, backdrop, Escape, and shortcut', () => {
    narrow = true
    const view = mount()
    const sidebar = view.container.querySelector('aside')!
    const opener = screen.getByRole('button', { name: 'Open sidebar' })
    fireEvent.click(opener)
    expect(sidebar.getAttribute('aria-hidden')).toBe('false')
    fireEvent.click(opener)
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    fireEvent.keyDown(window, { key: 'b', metaKey: true })
    expect(sidebar.getAttribute('aria-hidden')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }))
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(opener)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Navigate' }))
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps mobile web controls in the page header', () => {
    narrow = true
    Reflect.deleteProperty(window, 'pulpoDesktop')
    const view = mount()
    expect(view.container.querySelector('.desktop-sidebar-titlebar')).toBeNull()
    expect(screen.getByRole('button', { name: 'Model picker' }).parentElement?.tagName).toBe('HEADER')
  })
})
