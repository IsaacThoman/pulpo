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
  Sidebar: ({ mobile, mobileOpen, collapsed, transitions, onToggle, onNavigate }: {
    mobile: boolean; mobileOpen: boolean; collapsed: boolean; transitions: boolean; onToggle: () => void; onNavigate: () => void
  }) => <aside data-mobile={mobile} data-collapsed={collapsed} data-transitions={transitions} aria-hidden={mobile && !mobileOpen}>
    <button onClick={onToggle}>Toggle sidebar</button>
    <button onClick={onNavigate}>Navigate</button>
  </aside>,
}))

let narrow = false
// Every media query the layout watches reacts to the simulated resize.
let listeners: Array<() => void> = []
const resize = () => { for (const listener of listeners) listener() }
beforeEach(() => {
  narrow = false
  listeners = []
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({
    get matches() { return narrow },
    addEventListener: (_: string, listener: () => void) => { listeners.push(listener) },
    removeEventListener: vi.fn(),
  })) })
  Object.defineProperty(window, 'pulpoDesktop', { configurable: true, value: { os: 'darwin' } })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'pulpoDesktop')
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
  document.documentElement.style.removeProperty('--sidebar-width')
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

  it.each(['desktop', 'browser'])('opens and dismisses the compact %s sidebar using buttons, backdrop, Escape, and shortcut', (runtime) => {
    narrow = true
    if (runtime === 'browser') Reflect.deleteProperty(window, 'pulpoDesktop')
    const view = mount()
    const sidebar = view.container.querySelector('aside')!
    const opener = screen.getByRole('button', { name: 'Open sidebar' })
    expect(opener.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(opener)
    expect(opener.getAttribute('aria-expanded')).toBe('true')
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
    expect(opener.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps mobile web controls in the page header', () => {
    narrow = true
    Reflect.deleteProperty(window, 'pulpoDesktop')
    const view = mount()
    expect(view.container.querySelector('.desktop-sidebar-titlebar')).toBeNull()
    expect(screen.getByRole('button', { name: 'Model picker' }).parentElement?.tagName).toBe('HEADER')
  })
})

describe('desktop sidebar edge', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    HTMLElement.prototype.setPointerCapture = vi.fn()
  })

  // jsdom has no PointerEvent; React reads the pointer fields from a mouse event of the same name.
  const pointer = (type: string, clientX: number) =>
    fireEvent(screen.getByRole('separator', { name: 'Resize sidebar' }), new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX }))
  const edge = () => screen.getByRole('separator', { name: 'Resize sidebar' })
  const sidebarWidth = () => document.documentElement.style.getPropertyValue('--sidebar-width')

  it('follows the pointer without transitions and keeps the new width', () => {
    const view = mount()
    const sidebar = view.container.querySelector('aside')!
    expect(sidebarWidth()).toBe('264px')
    pointer('pointerdown', 264)
    expect(sidebar.getAttribute('data-transitions')).toBe('false')
    pointer('pointermove', 300)
    expect(sidebarWidth()).toBe('300px')
    pointer('pointermove', 271)
    expect(sidebarWidth()).toBe('264px')
    pointer('pointermove', 257)
    expect(sidebarWidth()).toBe('264px')
    pointer('pointermove', 254)
    expect(sidebarWidth()).toBe('254px')
    pointer('pointermove', 900)
    expect(sidebarWidth()).toBe('385px')
    pointer('pointermove', 340)
    expect(sidebarWidth()).toBe('340px')
    pointer('pointerup', 340)
    expect(sidebar.getAttribute('data-transitions')).toBe('true')
    expect(edge().getAttribute('aria-valuenow')).toBe('340')
    expect(localStorage.getItem('pulpo.sidebar.width')).toBe('340')
  })

  it('folds past the snap point, animating, and reopens at the width it had', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const view = mount()
    const sidebar = view.container.querySelector('aside')!
    pointer('pointerdown', 264)
    pointer('pointermove', 150)
    expect(sidebar.getAttribute('data-collapsed')).toBe('false')
    expect(sidebarWidth()).toBe('200px')
    pointer('pointermove', 100)
    expect(sidebar.getAttribute('data-collapsed')).toBe('true')
    expect(sidebar.getAttribute('data-transitions')).toBe('true')
    act(() => { vi.advanceTimersByTime(300) })
    expect(sidebar.getAttribute('data-transitions')).toBe('false')
    pointer('pointerup', 100)
    expect(sidebar.getAttribute('data-collapsed')).toBe('true')
    expect(sidebarWidth()).toBe('264px')
    expect(localStorage.getItem('pulpo.sidebar.width')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(sidebar.getAttribute('data-collapsed')).toBe('false')
    expect(edge().getAttribute('aria-valuenow')).toBe('264')
  })

  it('opens the folded rail when dragged out, at the dragged width', () => {
    const view = mount()
    const sidebar = view.container.querySelector('aside')!
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(sidebar.getAttribute('data-collapsed')).toBe('true')
    expect(edge().getAttribute('aria-valuenow')).toBe('52')
    pointer('pointerdown', 52)
    pointer('pointermove', 120)
    expect(sidebar.getAttribute('data-collapsed')).toBe('true')
    pointer('pointermove', 320)
    expect(sidebar.getAttribute('data-collapsed')).toBe('false')
    expect(sidebarWidth()).toBe('320px')
    pointer('pointerup', 320)
    expect(edge().getAttribute('aria-valuenow')).toBe('320')
    expect(localStorage.getItem('pulpo.sidebar.width')).toBe('320')
  })

  it('resizes and toggles from the keyboard, and double-click restores the default', () => {
    localStorage.setItem('pulpo.sidebar.width', '360')
    const view = mount()
    const sidebar = view.container.querySelector('aside')!
    expect(edge().getAttribute('aria-valuenow')).toBe('360')
    fireEvent.keyDown(edge(), { key: 'ArrowLeft' })
    expect(edge().getAttribute('aria-valuenow')).toBe('344')
    fireEvent.keyDown(edge(), { key: 'Enter' })
    expect(sidebar.getAttribute('data-collapsed')).toBe('true')
    fireEvent.doubleClick(edge())
    expect(sidebar.getAttribute('data-collapsed')).toBe('false')
    expect(edge().getAttribute('aria-valuenow')).toBe('264')
    expect(localStorage.getItem('pulpo.sidebar.width')).toBe('264')
  })

  it('caps a saved width, and leaves the main view its minimum in a narrow window', () => {
    localStorage.setItem('pulpo.sidebar.width', '480')
    const frameWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    mount()
    expect(sidebarWidth()).toBe('385px')
    expect(edge().getAttribute('aria-valuemax')).toBe('385')
    frameWidth.mockReturnValue(720)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(sidebarWidth()).toBe('360px')
    expect(edge().getAttribute('aria-valuemax')).toBe('360')
  })

  it('is not offered on mobile', () => {
    narrow = true
    mount()
    expect(screen.queryByRole('separator', { name: 'Resize sidebar' })).toBeNull()
  })
})
