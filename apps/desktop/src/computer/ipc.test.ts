import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerComputerIpc } from './ipc'
import type { ComputerService } from './service'

describe('computer IPC', () => {
  it('registers only the computer channels and checks the sender on each', async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>()
    const ipcMain = { handle: vi.fn((channel: string, handler: never) => { handlers.set(channel, handler) }) }
    const service = new Proxy({}, { get: () => vi.fn(async () => 'served') }) as unknown as ComputerService
    const assertTrustedSender = vi.fn((event: IpcMainInvokeEvent) => { if (!(event as unknown as { trusted: boolean }).trusted) throw new Error('Untrusted renderer.') })
    registerComputerIpc(ipcMain, service, assertTrustedSender)

    expect([...handlers.keys()].sort()).toEqual([
      'desktop:computer:allow-full-access', 'desktop:computer:begin', 'desktop:computer:changes:accept', 'desktop:computer:changes:get',
      'desktop:computer:changes:list', 'desktop:computer:changes:reject', 'desktop:computer:choose-folder', 'desktop:computer:end',
      'desktop:computer:forget-app', 'desktop:computer:forget-folder', 'desktop:computer:handle', 'desktop:computer:revoke-full-access', 'desktop:computer:sessions',
      'desktop:computer:status',
    ])
    for (const handler of handlers.values()) {
      await expect(handler({ trusted: false } as unknown as IpcMainInvokeEvent)).rejects.toThrow('Untrusted renderer.')
      await expect(handler({ trusted: true } as unknown as IpcMainInvokeEvent, {})).resolves.toBe('served')
    }
  })
})
