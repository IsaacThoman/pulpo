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
    expect(markup).toContain('bg-sidebar')
    expect(markup).toContain('border-sidebar-border')
    expect(markup).toContain('w-[264px]')
    expect(markup).toContain('z-40')
  })

  it('continues only the sidebar divider through the title bar when collapsed', () => {
    installDesktopWindow()
    const markup = renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed transitions={false} visible />,
    )

    expect(markup).toContain('w-[52px]')
    expect(markup).not.toContain('bg-sidebar')
    expect(markup).toContain('border-sidebar-border')
  })

  it('stays out of mobile layouts', () => {
    installDesktopWindow()
    expect(renderToStaticMarkup(
      <DesktopSidebarTitleBar collapsed={false} transitions visible={false} />,
    )).toBe('')
  })
})
