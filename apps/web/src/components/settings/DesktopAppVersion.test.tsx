// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopAppVersion } from './DesktopAppVersion'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'pulpoDesktop')
})

describe('DesktopAppVersion', () => {
  it('shows the version reported by the desktop app', async () => {
    Object.defineProperty(window, 'pulpoDesktop', {
      configurable: true,
      value: { appInfo: vi.fn().mockResolvedValue({ name: 'Pulpo', version: '1.2.3', packaged: true }) },
    })

    render(<DesktopAppVersion />)

    expect(screen.getByText('App version')).toBeTruthy()
    expect(await screen.findByText('1.2.3')).toBeTruthy()
  })

  it('does not render in the web runtime', () => {
    const view = render(<DesktopAppVersion />)
    expect(view.container.innerHTML).toBe('')
  })
})
