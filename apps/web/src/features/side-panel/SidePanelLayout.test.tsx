// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidePanelLayout } from './SidePanelLayout'
import { useSidePanel } from './store'

const panelRender = vi.hoisted(() => vi.fn())
vi.mock('./SidePanel', () => ({ SidePanel: (props: unknown) => { panelRender(props); return null } }))

let width = 1000
let resize: () => void
const disconnect = vi.fn()
beforeEach(() => {
  width = 1000
  panelRender.mockClear()
  disconnect.mockClear()
  useSidePanel.setState({ content: null, splitAvailable: true })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect = disconnect
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('side panel resize isolation', () => {
  it('only publishes breakpoint changes while closed, and measures fresh space on opening', () => {
    render(<SidePanelLayout mobile={false} full={false} enabled><div>Main view</div></SidePanelLayout>)
    panelRender.mockClear()
    const updates = vi.fn()
    const unsubscribe = useSidePanel.subscribe(updates)
    for (const next of [900, 800, 700, 680]) act(() => { width = next; resize() })
    expect(panelRender).not.toHaveBeenCalled()
    expect(updates).not.toHaveBeenCalled()
    act(() => { width = 679; resize() })
    expect(useSidePanel.getState().splitAvailable).toBe(false)
    expect(updates).toHaveBeenCalledTimes(1)
    act(() => { width = 680; resize() })
    expect(useSidePanel.getState().splitAvailable).toBe(true)
    expect(updates).toHaveBeenCalledTimes(2)
    unsubscribe()
    act(() => { useSidePanel.getState().open({ kind: 'folder', id: null }) })
    expect(panelRender).toHaveBeenLastCalledWith({ available: 680, full: false })
  })

  it('resizes an open panel without rerendering the main view', () => {
    const mainRender = vi.fn()
    function Main() { mainRender(); return <div>Main view</div> }
    useSidePanel.getState().open({ kind: 'folder', id: null })
    const view = render(<SidePanelLayout mobile={false} full={false} enabled><Main /></SidePanelLayout>)
    expect(panelRender).toHaveBeenLastCalledWith({ available: 1000, full: false })
    mainRender.mockClear()
    for (const next of [990, 900, 800, 690]) act(() => { width = next; resize() })
    expect(panelRender).toHaveBeenLastCalledWith({ available: 690, full: false })
    expect(mainRender).not.toHaveBeenCalled()
    act(() => { useSidePanel.getState().close() })
    panelRender.mockClear()
    act(() => { width = 750; resize() })
    expect(panelRender).not.toHaveBeenCalled()
    view.unmount()
    expect(disconnect).toHaveBeenCalled()
  })

  it('disables splitting on mobile and omits the panel for admin views', () => {
    useSidePanel.getState().open({ kind: 'folder', id: null })
    const view = render(<SidePanelLayout mobile full enabled><div>Main view</div></SidePanelLayout>)
    expect(useSidePanel.getState().splitAvailable).toBe(false)
    expect(panelRender).toHaveBeenLastCalledWith({ available: 0, full: true })
    view.rerender(<SidePanelLayout mobile={false} full={false} enabled><div>Main view</div></SidePanelLayout>)
    expect(useSidePanel.getState().splitAvailable).toBe(true)
    expect(panelRender).toHaveBeenLastCalledWith({ available: 1000, full: false })
    panelRender.mockClear()
    view.rerender(<SidePanelLayout mobile={false} full={false} enabled={false}><div>Main view</div></SidePanelLayout>)
    expect(panelRender).not.toHaveBeenCalled()
  })

  it('supports the window resize fallback', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    useSidePanel.getState().open({ kind: 'folder', id: null })
    render(<SidePanelLayout mobile={false} full={false} enabled><div>Main view</div></SidePanelLayout>)
    act(() => { width = 800; window.dispatchEvent(new Event('resize')) })
    expect(panelRender).toHaveBeenLastCalledWith({ available: 800, full: false })
  })
})
