import { describe, expect, it, vi } from 'vitest'
import { fileMenuItems } from './file-menu'

describe('desktop File menu', () => {
  it('closes the window with Cmd/Ctrl+W outside Files', () => {
    const items = fileMenuItems(false, vi.fn())
    expect(items.map((item) => item.label ?? item.role ?? item.type)).toEqual(['New Chat', 'separator', 'close'])
    expect(items.find((item) => item.role === 'close')?.accelerator).toBeUndefined()
  })

  it('offers tab items while Files tabs show, with Cmd/Ctrl+W closing a tab', () => {
    const send = vi.fn()
    const items = fileMenuItems(true, send)
    const byLabel = (label: string) => items.find((item) => item.label === label)!
    expect(byLabel('Close Tab').accelerator).toBe('CmdOrCtrl+W')
    expect(items.find((item) => item.role === 'close')?.accelerator).toBe('CmdOrCtrl+Shift+W')
    expect(byLabel('New Tab').accelerator).toBe('CmdOrCtrl+T')
    expect(byLabel('Reopen Closed Tab').accelerator).toBe('CmdOrCtrl+Shift+T')
    const click = (label: string) => (byLabel(label).click as () => void)()
    click('New Tab')
    click('Close Tab')
    click('Reopen Closed Tab')
    expect(send.mock.calls.map(([command]) => command)).toEqual(['files-new-tab', 'files-close-tab', 'files-reopen-tab'])
  })
})
