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
})
