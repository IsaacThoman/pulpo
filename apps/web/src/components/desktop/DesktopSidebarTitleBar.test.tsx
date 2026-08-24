import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesktopSidebarTitleBar } from './DesktopSidebarTitleBar'

function installDesktopWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { pulpoDesktop: { platform: 'desktop' }, location: { origin: 'https://desktop.pulpo.invalid' } },
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
    expect(markup).toContain('bg-sidebar')
    expect(markup).toContain('border-sidebar-border')
    expect(markup).toContain('w-[52px]')
    expect(markup).toContain('left-[52px]')
    expect(markup).toContain('w-[212px]')
    expect(markup).toContain('opacity-100')
    expect(markup).toContain('z-40')
    expect(markup).toContain('-translate-y-[54px]')
    expect(markup).toContain('transition-transform')
    expect(markup).toContain('transition-[width,opacity]')
  })

  it('makes the collapsed title bar a full-width sidebar surface with a curved boundary', () => {
    installDesktopWindow()
    const markup = renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed transitions={false} visible />,
    )

    expect(markup).toContain('data-collapsed="true"')
    expect(markup).toContain('desktop-sidebar-titlebar-collapsed')
    expect(markup).toContain('w-full')
    expect(markup).toContain('bg-sidebar')
    expect(markup).toContain('translate-y-0')
    expect(markup).toContain('desktop-sidebar-titlebar-base')
    expect(markup).toContain('w-0')
    expect(markup).toContain('opacity-0')
  })

  it('stays out of mobile layouts', () => {
    installDesktopWindow()
    expect(renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed={false} transitions visible={false} />,
    )).toBe('')
  })
})
