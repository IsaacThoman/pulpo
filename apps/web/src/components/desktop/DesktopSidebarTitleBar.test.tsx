import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesktopSidebarTitleBar } from './DesktopSidebarTitleBar'

function installDesktopWindow(os: 'darwin' | 'win32' = 'darwin'): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { pulpoDesktop: { platform: 'desktop', os }, location: { origin: 'https://desktop.pulpo.invalid' } },
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('desktop sidebar title bar', () => {
  it('extends the expanded sidebar color and border through the title bar', () => {
    installDesktopWindow()
    const markup = renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed={false} transitions visible />,
    )

    expect(markup).toContain('desktop-sidebar-titlebar')
    expect(markup).toContain('desktop-sidebar-titlebar-base')
    expect(markup).toContain('desktop-sidebar-titlebar-expanded')
    expect(markup).toContain('desktop-sidebar-titlebar-expanded-border')
    expect(markup).toContain('z-10')
    expect(markup).toContain('bg-sidebar')
    expect(markup).toContain('border-sidebar-border')
    expect(markup).toContain('w-[52px]')
    expect(markup).toContain('left-[52px]')
    expect(markup).toContain('w-[212px]')
    expect(markup).toContain('z-[42]')
    expect(markup).toContain('-translate-y-[54px]')
    expect(markup).toContain('transition-transform')
    expect(markup).toContain('transition-[width]')
    expect(markup).toContain('transition-opacity')
    expect(markup).toContain('opacity-100')
    expect(markup).not.toContain('data-animation-active')
  })

  it('makes the collapsed title bar a full-width sidebar surface with a curved boundary', () => {
    installDesktopWindow()
    const markup = renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed transitions visible />,
    )

    expect(markup).toContain('data-collapsed="true"')
    expect(markup).toContain('desktop-sidebar-titlebar-collapsed')
    expect(markup).toContain('z-0')
    expect(markup).toContain('w-full')
    expect(markup).toContain('bg-sidebar')
    expect(markup).not.toContain('translate-y-0')
    expect(markup).toContain('desktop-sidebar-titlebar-base')
    expect(markup).toContain('w-0')
    expect(markup).toContain('opacity-0')
    expect(markup).toContain('z-[42]')
    expect(markup).toContain('desktop-model-titlebar-slot')
    expect(markup).toContain('desktop-actions-titlebar-slot')
    expect(markup.match(/desktop-no-drag/g)).toHaveLength(2)
    expect(markup).toContain('h-[38px]')
    expect(markup).toContain('transition-[left,height]')
    expect(markup).toContain('transition-[height]')
    expect(markup).toContain('z-[43]')
  })

  it('uses the compact title bar itself as the focused drag surface', () => {
    installDesktopWindow()
    const markup = renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed compact transitions visible />,
    )

    expect(markup.match(/data-compact="true"/g)).toHaveLength(3)
    expect(markup).toContain('desktop-sidebar-titlebar')
    expect(markup).not.toContain('desktop-sidebar-titlebar pointer-events-none')
    expect(markup).toContain('desktop-sidebar-titlebar-collapsed pointer-events-none')
    expect(markup).toContain('-webkit-app-region:drag')
    expect(markup).toContain('-webkit-app-region:no-drag')
    expect(markup).not.toContain('translate-y-0')
    expect(markup).toContain('w-fit')
  })

  it('keeps Windows drag and portal layers without rendering surfaces above the sidebar', () => {
    installDesktopWindow('win32')
    const markup = renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed transitions visible />,
    )

    expect(markup).not.toContain('desktop-sidebar-titlebar-collapsed')
    expect(markup).not.toContain('desktop-sidebar-titlebar-base')
    expect(markup).not.toContain('desktop-sidebar-titlebar-expanded')
    expect(markup).toContain('desktop-sidebar-titlebar')
    expect(markup).toContain('z-40')
    expect(markup).toContain('desktop-model-titlebar-slot')
    expect(markup).toContain('desktop-actions-titlebar-slot')
    expect(markup).not.toContain('data-position-animation-active')
  })

  it('stays out of mobile layouts', () => {
    installDesktopWindow()
    expect(renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed={false} transitions visible={false} />,
    )).toBe('')
  })

  it('stays out of non-desktop rendering environments', () => {
    expect(renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed={false} transitions visible />,
    )).toBe('')
  })
})
