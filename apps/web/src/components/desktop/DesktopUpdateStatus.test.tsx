// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopUpdateState } from '@/lib/runtime'
import { DesktopUpdateStatus } from './DesktopUpdateStatus'

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
  Reflect.deleteProperty(window, 'pulpoDesktop')
})

describe('DesktopUpdateStatus', () => {
  it('shows only when an update is ready', async () => {
    const desktop = installDesktopApi({ status: 'idle' })
    render(<DesktopUpdateStatus />)
    expect(screen.queryByText('Update Available')).toBeNull()

    await act(async () => desktop.emit({ status: 'ready', version: '1.2.3' }))

    const indicator = screen.getByRole('button', { name: 'Restart to install Pulpo v1.2.3' })
    expect(indicator.textContent).toBe('Update Available')
    expect(indicator.className).toContain('hover:text-foreground')
  })

  it('restarts and installs through the desktop bridge', async () => {
    const desktop = installDesktopApi({ status: 'ready', version: '1.2.3' })
    render(<DesktopUpdateStatus />)

    fireEvent.click(await screen.findByRole('button', { name: 'Restart to install Pulpo v1.2.3' }))

    expect(desktop.restartAndInstall).toHaveBeenCalledTimes(1)
  })

  it('separates the update from a connection status when both are visible', async () => {
    installDesktopApi({ status: 'ready', version: '1.2.3' })
    const view = render(<DesktopUpdateStatus separated />)

    await screen.findByText('Update Available')
    expect(view.container.textContent).toBe('·Update Available')
  })

  it('removes its update listener when unmounted', () => {
    const desktop = installDesktopApi({ status: 'idle' })
    const view = render(<DesktopUpdateStatus />)
    view.unmount()
    expect(desktop.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
