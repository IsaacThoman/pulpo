// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesktopTitleBarSurface } from './DesktopTitleBar'

function installDesktopApi(os: 'darwin' | 'win32' = 'darwin') {
  let maximizedListener: ((maximized: boolean) => void) | undefined
  let maximized = false
  const windowUnsubscribe = vi.fn()
  const minimize = vi.fn().mockResolvedValue(undefined)
  const close = vi.fn().mockResolvedValue(undefined)
  const toggleMaximize = vi.fn().mockImplementation(async () => {
    maximized = !maximized
    return maximized
  })
  const isMaximized = vi.fn().mockImplementation(async () => maximized)
  Object.defineProperty(window, 'pulpoDesktop', {
    configurable: true,
    value: {
      os,
      windowControls: {
        minimize,
        close,
        toggleMaximize,
        isMaximized,
        onMaximizedChanged: vi.fn((next: (value: boolean) => void) => {
          maximizedListener = next
          return windowUnsubscribe
        }),
      },
    },
  })
  return {
    minimize,
    close,
    toggleMaximize,
    windowUnsubscribe,
    emitMaximized: (value: boolean) => {
      maximized = value
      maximizedListener?.(value)
    },
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

  it('shows working custom window controls on Windows', async () => {
    const desktop = installDesktopApi('win32')
    const view = render(<DesktopTitleBarSurface temporaryChat={false} />)

    const minimize = screen.getByRole('button', { name: 'Minimize' })
    const maximize = screen.getByRole('button', { name: 'Maximize' })
    const close = screen.getByRole('button', { name: 'Close' })
    expect(minimize.parentElement?.className).toContain('desktop-no-drag')

    fireEvent.click(minimize)
    fireEvent.click(close)
    expect(desktop.minimize).toHaveBeenCalledTimes(1)
    expect(desktop.close).toHaveBeenCalledTimes(1)

    await act(async () => { fireEvent.click(maximize) })
    expect(desktop.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()

    act(() => desktop.emitMaximized(false))
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeTruthy()

    view.unmount()
    expect(desktop.windowUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('keeps Windows controls out of the macOS title bar', () => {
    installDesktopApi('darwin')
    render(<DesktopTitleBarSurface temporaryChat={false} />)

    expect(screen.queryByRole('button', { name: 'Minimize' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})
