// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopUpdateState } from '@/lib/runtime'
import { DesktopTitleBarSurface } from './DesktopTitleBar'

function installDesktopApi(initial: DesktopUpdateState) {
  let listener: ((state: DesktopUpdateState) => void) | undefined
  const unsubscribe = vi.fn()
  const restartAndInstall = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window, 'pulpoDesktop', {
    configurable: true,
    value: {
      updates: {
        getState: vi.fn().mockResolvedValue(initial),
        onStateChanged: vi.fn((next: (state: DesktopUpdateState) => void) => {
          listener = next
          return unsubscribe
        }),
        restartAndInstall,
      },
    },
  })
  return {
    emit: (state: DesktopUpdateState) => listener?.(state),
    restartAndInstall,
    unsubscribe,
  }
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  Reflect.deleteProperty(window, 'pulpoDesktop')
})

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

  it('uses the same status slot when a desktop update is ready', async () => {
    const desktop = installDesktopApi({ status: 'idle' })
    render(<DesktopTitleBarSurface temporaryChat={false} />)
    expect(screen.queryByText(/Update to/)).toBeNull()

    await act(async () => desktop.emit({ status: 'ready', version: '1.2.3' }))

    const update = screen.getByRole('button', { name: 'Update to v1.2.3' })
    expect(update.getAttribute('title')).toBe('Restart to install Pulpo v1.2.3')
    expect(update.className).toContain('left-[84px]')
    fireEvent.click(update)
    expect(desktop.restartAndInstall).toHaveBeenCalledTimes(1)
  })

  it('gives connection state priority over a ready update', async () => {
    installDesktopApi({ status: 'ready', version: '1.2.3' })
    render(<DesktopTitleBarSurface temporaryChat={false} connectionStatus="offline" />)
    await act(async () => undefined)

    expect(screen.getByText('Offline · Retry')).toBeTruthy()
    expect(screen.queryByText(/Update to/)).toBeNull()
  })

  it('removes its desktop update listener when unmounted', () => {
    const desktop = installDesktopApi({ status: 'idle' })
    const view = render(<DesktopTitleBarSurface temporaryChat={false} />)
    view.unmount()
    expect(desktop.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
