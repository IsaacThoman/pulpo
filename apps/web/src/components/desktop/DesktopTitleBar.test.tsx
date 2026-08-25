import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesktopTitleBarSurface } from './DesktopTitleBar'

describe('desktop title bar', () => {
  it('marks the title bar while temporary chat mode is active', () => {
    const markup = renderToStaticMarkup(<DesktopTitleBarSurface temporaryChat />)

    expect(markup).toContain('data-temporary-chat="true"')
    expect(markup).toContain('transition-colors')
  })

  it('leaves the normal title bar unmarked', () => {
    const markup = renderToStaticMarkup(<DesktopTitleBarSurface temporaryChat={false} />)

    expect(markup).not.toContain('data-temporary-chat')
  })

  it('shows non-blocking desktop connection states', () => {
    const connecting = renderToStaticMarkup(
      <DesktopTitleBarSurface temporaryChat={false} connectionStatus="connecting" />,
    )
    const offline = renderToStaticMarkup(
      <DesktopTitleBarSurface temporaryChat={false} connectionStatus="offline" />,
    )

    expect(connecting).toContain('Connecting…')
    expect(connecting).toContain('role="status"')
    expect(connecting).toContain('left-[84px]')
    expect(connecting).not.toContain('right-3')
    expect(offline).toContain('Offline · Retry')
    expect(offline).toContain('<button')
    expect(offline).toContain('left-[84px]')
    expect(offline).not.toContain('right-3')
  })
})
