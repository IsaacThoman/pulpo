// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComputerAllowedApp, ComputerFolder } from '@pulpo/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputerAccessSettings } from './ComputerAccessSettings'

function installBridge(initial: { fullAccess: boolean; folders: ComputerFolder[]; apps?: ComputerAllowedApp[] }, extra: Record<string, unknown> = {}) {
  let allowed = initial
  const computer = {
    status: vi.fn(async () => ({ ...allowed, defaultFolder: { path: '/Users/me/Pulpo', name: 'Pulpo' } })),
    revokeFullAccess: vi.fn(async () => { allowed = { ...allowed, fullAccess: false } }),
    forgetFolder: vi.fn(async (folder: string) => { allowed = { ...allowed, folders: allowed.folders.filter((entry) => entry.path !== folder) } }),
    forgetApp: vi.fn(async (id: string) => { allowed = { ...allowed, apps: allowed.apps?.filter((entry) => entry.id !== id) } }),
    ...extra,
  }
  Object.defineProperty(window, 'pulpoDesktop', { configurable: true, value: { platform: 'desktop', computer } })
  return computer
}

afterEach(() => {
  cleanup()
  delete (window as { pulpoDesktop?: unknown }).pulpoDesktop
})

describe('ComputerAccessSettings', () => {
  it('shows nothing in a browser, or before anything was allowed', async () => {
    const { container, unmount } = render(<ComputerAccessSettings />)
    expect(container.innerHTML).toBe('')
    unmount()
    const computer = installBridge({ fullAccess: false, folders: [] })
    const second = render(<ComputerAccessSettings />)
    await waitFor(() => expect(computer.status).toHaveBeenCalled())
    expect(second.container.innerHTML).toBe('')
  })

  it('lists what was allowed and takes each thing back', async () => {
    const computer = installBridge({ fullAccess: true, folders: [{ path: '/Users/me/site', name: 'site' }, { path: '/Users/me/notes', name: 'notes' }] })
    render(<ComputerAccessSettings />)
    expect(await screen.findByText('Full access')).toBeTruthy()
    expect(screen.getByText('/Users/me/site')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(screen.queryByText('Full access')).toBeNull())
    expect(computer.revokeFullAccess).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Remove site' }))
    await waitFor(() => expect(screen.queryByText('/Users/me/site')).toBeNull())
    expect(computer.forgetFolder).toHaveBeenCalledWith('/Users/me/site')
    expect(screen.getByText('/Users/me/notes')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove notes' }))
    await waitFor(() => expect(screen.queryByText('This computer')).toBeNull())
  })

  it('lists the apps the agent may use and takes one back', async () => {
    const computer = installBridge({ fullAccess: true, folders: [], apps: [{ id: 'com.apple.TextEdit', name: 'TextEdit' }, { id: 'com.apple.Safari', name: 'Safari' }] })
    render(<ComputerAccessSettings />)
    expect(await screen.findByText('Apps the agent may use')).toBeTruthy()
    expect(screen.getByText('TextEdit')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Safari' }))
    await waitFor(() => expect(screen.queryByText('Safari')).toBeNull())
    expect(computer.forgetApp).toHaveBeenCalledWith('com.apple.Safari')
    expect(screen.getByText('TextEdit')).toBeTruthy()
    // Full access is still listed, and still taken back by itself.
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeTruthy()
  })

  it('keeps listing an allowed app after full access was turned off, so it can still be removed', async () => {
    installBridge({ fullAccess: false, folders: [], apps: [{ id: 'notepad.exe', name: 'Notepad' }] })
    render(<ComputerAccessSettings />)
    expect(await screen.findByText('Notepad')).toBeTruthy()
    expect(screen.queryByText('Full access')).toBeNull()
  })

  it('shows no apps for a desktop app that cannot control them', async () => {
    installBridge({ fullAccess: true, folders: [] }, { forgetApp: undefined })
    render(<ComputerAccessSettings />)
    expect(await screen.findByText('Full access')).toBeTruthy()
    expect(screen.queryByText('Apps the agent may use')).toBeNull()
  })

  it('offers nothing when the desktop app is too old to take access back', async () => {
    const computer = installBridge({ fullAccess: true, folders: [] }, { revokeFullAccess: undefined, forgetFolder: undefined })
    const { container } = render(<ComputerAccessSettings />)
    await waitFor(() => expect(computer.status).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})
