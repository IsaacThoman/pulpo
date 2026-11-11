// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { DesktopActionsTitleBarSlot, DesktopModelTitleBarSlot } from '@/components/desktop/DesktopSidebarTitleBar'
import { useDesktopChrome } from '@/stores/desktopChrome'
import { useSidePanel } from '@/features/side-panel/store'

vi.mock('@/stores/chat', () => ({ useChat: { getState: () => ({ abandonTemporaryChat: vi.fn() }) } }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: { user: null; filesEnabled: boolean }) => unknown) => select({ user: null, filesEnabled: true }) }))
vi.mock('@/stores/settings', () => ({
  useSettings: (select: (state: { doubleShiftSearch: boolean; animationSpeed: number }) => unknown) =>
    select({ doubleShiftSearch: false, animationSpeed: 1 }),
}))
vi.mock('@/features/chat/ChatDataBridge', () => ({ ChatDataBridge: () => null }))
vi.mock('@/features/settings/SettingsBridge', () => ({ SettingsBridge: () => null }))
vi.mock('./BannerBar', () => ({ BannerBar: () => null }))
vi.mock('@/features/side-panel/SidePanelLayout', () => ({
  SidePanelLayout: ({ full, children }: { full: boolean; children: React.ReactNode }) => <>
    {children}
    {full && <aside data-side-panel aria-label="Side panel"><p>Panel text</p><button>Panel action</button></aside>}
  </>,
}))
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
    // The backdrop is a pointer target only; it is hidden from assistive technology.
    fireEvent.click(view.container.querySelector('.mobile-sidebar-backdrop')!)
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(opener)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Navigate' }))
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    expect(opener.getAttribute('aria-expanded')).toBe('false')
  })

  it('makes the open drawer modal: focus moves in, the page behind is inert, and focus returns', async () => {
    narrow = true
    Reflect.deleteProperty(window, 'pulpoDesktop')
    const view = mount()
    const sidebar = view.container.querySelector('aside')!
    const opener = screen.getByRole('button', { name: 'Open sidebar' })
    const main = view.container.querySelector('main')!
    opener.focus()
    fireEvent.click(opener)
    expect(main.closest('[inert]')).not.toBeNull()
    expect(opener.hasAttribute('inert')).toBe(true)
    expect(screen.getByText('Skip to message').closest('a')!.hasAttribute('inert')).toBe(true)
    await act(() => new Promise(requestAnimationFrame))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Toggle sidebar' }))
    // Tab wraps from the drawer's last control to its first, and Shift+Tab back.
    screen.getByRole('button', { name: 'Navigate' }).focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Toggle sidebar' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Navigate' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    expect(main.closest('[inert]')).toBeNull()
    await act(() => new Promise(requestAnimationFrame))
    expect(document.activeElement).toBe(opener)
  })

  it('lets a dialog opened from the drawer keep Tab inside itself', async () => {
    narrow = true
    Reflect.deleteProperty(window, 'pulpoDesktop')
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    await act(() => new Promise(requestAnimationFrame))
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const field = document.createElement('input')
    dialog.append(field)
    document.body.append(dialog)
    field.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    field.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(field)
    dialog.remove()
  })

  it('keeps mobile web controls in the page header', () => {
    narrow = true
    Reflect.deleteProperty(window, 'pulpoDesktop')
    const view = mount()
    expect(view.container.querySelector('.desktop-sidebar-titlebar')).toBeNull()
    expect(screen.getByRole('button', { name: 'Model picker' }).parentElement?.tagName).toBe('HEADER')
  })
})

describe('skip link and shortcuts', () => {
  it('starts the page with a skip link to the main content', () => {
    const view = mount()
    const links = view.container.querySelectorAll('a[href], button')
    expect(links[0]?.textContent).toBe('Skip to message')
    const main = view.container.querySelector('main')!
    fireEvent.click(links[0]!)
    expect(document.activeElement).toBe(main)
  })

  it('skips to the side panel when it fills the screen and hides the main view', () => {
    narrow = true
    Reflect.deleteProperty(window, 'pulpoDesktop')
    act(() => { useSidePanel.setState({ content: { kind: 'folder', id: null } }) })
    const view = mount()
    const link = screen.getByText('Skip to side panel').closest('a')!
    expect(view.container.querySelector('main')!.className).toContain('hidden')
    fireEvent.click(link)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Panel action' }))
    act(() => { useSidePanel.setState({ content: null }) })
  })

  it('leaves Cmd/Ctrl+B to editors that handle it, and to rich text', () => {
    const view = mount()
    const sidebar = view.container.querySelector('aside')!
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    view.container.querySelector('main')!.append(editor)
    fireEvent.keyDown(editor, { key: 'b', metaKey: true })
    expect(sidebar.getAttribute('data-collapsed')).toBe('false')
    const handled = new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true, cancelable: true })
    handled.preventDefault()
    act(() => { window.dispatchEvent(handled) })
    expect(sidebar.getAttribute('data-collapsed')).toBe('false')
    fireEvent.keyDown(window, { key: 'b', metaKey: true })
    expect(sidebar.getAttribute('data-collapsed')).toBe('true')
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
