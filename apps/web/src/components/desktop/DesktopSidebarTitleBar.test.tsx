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
    expect(markup).toContain('desktop-sidebar-titlebar-expanded-border')
    expect(markup).toContain('z-10')
    expect(markup).toContain('bg-sidebar')
    expect(markup).toContain('border-sidebar-border')
    expect(markup).toContain('w-[52px]')
    expect(markup).toContain('left-[52px]')
    expect(markup).toContain('w-[212px]')
    expect(markup).toContain('z-[42]')
    expect(markup).toContain('transition-[width]')
    expect(markup).toContain('transition-opacity')
    expect(markup).toContain('opacity-100')
    expect(markup).toContain('hidden')
  })

  it('curves the collapsed title bar around the macOS traffic lights', () => {
    installDesktopWindow()
    const markup = renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed transitions={false} visible />,
    )

    expect(markup).toContain('data-collapsed="true"')
    expect(markup).toContain('desktop-sidebar-titlebar-collapsed')
    expect(markup).toContain('z-0')
    expect(markup).toContain('w-[124px]')
    expect(markup).toContain('rounded-br-[22px]')
    expect(markup).toContain('border-b')
    expect(markup).toContain('border-r')
    expect(markup).toContain('bg-sidebar')
    expect(markup).toContain('desktop-sidebar-titlebar-collapsed-seam-cover')
    expect(markup).toContain('w-[67px]')
    expect(markup).toContain('block')
    expect(markup).toContain('desktop-sidebar-titlebar-base')
    expect(markup).toContain('w-0')
    expect(markup).toContain('opacity-0')
    expect(markup).toContain('z-[42]')
  })

  it('stays out of mobile layouts', () => {
    installDesktopWindow()
    expect(renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed={false} transitions visible={false} />,
    )).toBe('')
  })
})
