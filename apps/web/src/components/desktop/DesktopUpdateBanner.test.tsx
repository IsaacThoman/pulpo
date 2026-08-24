// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopUpdateState } from '@/lib/runtime'
import { DesktopUpdateBanner } from './DesktopUpdateBanner'

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

describe('DesktopUpdateBanner', () => {
  it('renders only after a desktop update is ready', async () => {
    const desktop = installDesktopApi({ status: 'idle' })
    render(<DesktopUpdateBanner />)
    expect(screen.queryByText(/is ready/)).toBeNull()
    await act(async () => desktop.emit({ status: 'ready', version: '1.2.3' }))
    expect(screen.getByText('Pulpo v1.2.3 is ready.')).toBeTruthy()
  })

  it('restarts through the desktop bridge', async () => {
    const desktop = installDesktopApi({ status: 'ready', version: '1.2.3' })
    render(<DesktopUpdateBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }))
    expect(desktop.restartAndInstall).toHaveBeenCalledTimes(1)
  })

  it('dismisses a version for the rest of the app session', async () => {
    installDesktopApi({ status: 'ready', version: '1.2.3' })
    const first = render(<DesktopUpdateBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }))
    expect(screen.queryByText(/is ready/)).toBeNull()
    first.unmount()
    render(<DesktopUpdateBanner />)
    await act(async () => undefined)
    expect(screen.queryByText(/is ready/)).toBeNull()
  })

  it('removes its update listener when unmounted', () => {
    const desktop = installDesktopApi({ status: 'idle' })
    const view = render(<DesktopUpdateBanner />)
    view.unmount()
    expect(desktop.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not render in the web runtime', () => {
    const view = render(<DesktopUpdateBanner />)
    expect(view.container.innerHTML).toBe('')
  })
})
