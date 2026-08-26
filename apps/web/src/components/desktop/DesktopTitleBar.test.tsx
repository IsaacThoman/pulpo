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
  vi.useRealTimers()
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
    expect(offline).toContain('Offline')
    expect(offline).toContain('role="status"')
    expect(offline).not.toContain('<button')
    expect(offline).toContain('left-[84px]')
    expect(offline).not.toContain('right-3')
  })

  it('retries every 15 seconds while offline', () => {
    vi.useFakeTimers()
    const onRetry = vi.fn()
    const view = render(
      <DesktopTitleBarSurface temporaryChat={false} connectionStatus="offline" onRetry={onRetry} />,
    )

    act(() => vi.advanceTimersByTime(14_999))
    expect(onRetry).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onRetry).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(15_000))
    expect(onRetry).toHaveBeenCalledTimes(2)

    view.rerender(
      <DesktopTitleBarSurface temporaryChat={false} connectionStatus="connecting" onRetry={onRetry} />,
    )
    act(() => vi.advanceTimersByTime(15_000))
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('uses the same status slot when a desktop update is ready', async () => {
    const desktop = installDesktopApi({ status: 'idle' })
    render(<DesktopTitleBarSurface temporaryChat={false} />)
    expect(screen.queryByText(/Update to/)).toBeNull()

    await act(async () => desktop.emit({ status: 'ready', version: '1.2.3' }))

    const update = screen.getByRole('button', { name: 'Update to v1.2.3' })
    expect(update.getAttribute('title')).toBe('Restart to install Pulpo v1.2.3')
    expect(update.className).toContain('left-[84px]')
    expect(update.className).toContain('text-muted-foreground')
    expect(update.className).not.toContain('underline')
    expect(update.innerHTML).toContain('lucide-circle-arrow-up')
    fireEvent.click(update)
    expect(desktop.restartAndInstall).toHaveBeenCalledTimes(1)
    expect(update.textContent).toBe('Restarting…')
    expect(update.innerHTML).toContain('animate-spin')
  })

  it('shows download activity ahead of connection state', async () => {
    const desktop = installDesktopApi({ status: 'idle' })
    render(<DesktopTitleBarSurface temporaryChat={false} connectionStatus="offline" />)

    await act(async () => desktop.emit({ status: 'downloading' }))

    const downloading = screen.getByRole('status')
    expect(downloading.textContent).toBe('Downloading update…')
    expect(downloading.className).toContain('left-[84px]')
    expect(downloading.innerHTML).toContain('animate-spin')
    expect(screen.queryByText('Offline')).toBeNull()
  })

  it('shows update checks ahead of connection state', async () => {
    installDesktopApi({ status: 'checking' })
    render(<DesktopTitleBarSurface temporaryChat={false} connectionStatus="connecting" />)

    expect(await screen.findByText('Checking for updates…')).toBeTruthy()
    expect(screen.queryByText('Connecting…')).toBeNull()
  })

  it('gives a ready update priority over connection state', async () => {
    installDesktopApi({ status: 'ready', version: '1.2.3' })
    render(<DesktopTitleBarSurface temporaryChat={false} connectionStatus="offline" />)

    expect(await screen.findByRole('button', { name: 'Update to v1.2.3' })).toBeTruthy()
    expect(screen.queryByText('Offline')).toBeNull()
  })

  it('removes its desktop update listener when unmounted', () => {
    const desktop = installDesktopApi({ status: 'idle' })
    const view = render(<DesktopTitleBarSurface temporaryChat={false} />)
    view.unmount()
    expect(desktop.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
