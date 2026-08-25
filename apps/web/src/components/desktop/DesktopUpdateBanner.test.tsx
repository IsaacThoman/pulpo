// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopUpdateState } from '@/lib/runtime'
import { DesktopUpdateLink } from './DesktopUpdateBanner'

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

describe('DesktopUpdateLink', () => {
  it('renders only after a desktop update is ready', async () => {
    const desktop = installDesktopApi({ status: 'idle' })
    render(<DesktopUpdateLink />)
    expect(screen.queryByText(/Update to/)).toBeNull()
    await act(async () => desktop.emit({ status: 'ready', version: '1.2.3' }))
    const indicator = screen.getByRole('button', { name: 'Update to v1.2.3' })
    expect(indicator.getAttribute('title')).toBe('Restart to install Pulpo v1.2.3')
    expect(indicator.textContent).toBe('Update')
    expect(indicator.className).toContain('h-7')
    expect(indicator.className).toContain('border')
    expect(indicator.innerHTML).toContain('size-3.5')
  })

  it('restarts through the desktop bridge', async () => {
    const desktop = installDesktopApi({ status: 'ready', version: '1.2.3' })
    render(<DesktopUpdateLink />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update to v1.2.3' }))
    expect(desktop.restartAndInstall).toHaveBeenCalledTimes(1)
  })

  it('can hide with the collapsed sidebar header', async () => {
    installDesktopApi({ status: 'ready', version: '1.2.3' })
    render(<DesktopUpdateLink hidden />)
    await act(async () => undefined)
    expect(screen.queryByText(/Update to/)).toBeNull()
  })

  it('removes its update listener when unmounted', () => {
    const desktop = installDesktopApi({ status: 'idle' })
    const view = render(<DesktopUpdateLink />)
    view.unmount()
    expect(desktop.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not render in the web runtime', () => {
    const view = render(<DesktopUpdateLink />)
    expect(view.container.innerHTML).toBe('')
  })
})
