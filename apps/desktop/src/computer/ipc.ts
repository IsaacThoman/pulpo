import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { DesktopComputerUpdate } from '@pulpo/contracts'
import type { ComputerAgent } from './agent'

const ACCESS_MODES = new Set(['folder', 'full'])
const APPROVAL_POLICIES = new Set(['default', 'bash-only', 'never'])

/** Only the fields the renderer may change, each validated; the main process stays the source of truth. */
export function validComputerUpdate(value: unknown): DesktopComputerUpdate {
  if (!value || typeof value !== 'object') throw new Error('Invalid computer settings.')
  const candidate = value as Record<string, unknown>
  const update: DesktopComputerUpdate = {}
  if ('enabled' in candidate) {
    if (typeof candidate.enabled !== 'boolean') throw new Error('Invalid computer settings.')
    update.enabled = candidate.enabled
  }
  if ('allowRemote' in candidate) {
    if (typeof candidate.allowRemote !== 'boolean') throw new Error('Invalid computer settings.')
    update.allowRemote = candidate.allowRemote
  }
  if ('name' in candidate) {
    if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 120) throw new Error('Invalid computer name.')
    update.name = candidate.name.trim()
  }
  if ('accessMode' in candidate) {
    if (typeof candidate.accessMode !== 'string' || !ACCESS_MODES.has(candidate.accessMode)) throw new Error('Invalid access mode.')
    update.accessMode = candidate.accessMode as DesktopComputerUpdate['accessMode']
  }
  if ('approvalPolicy' in candidate) {
    if (typeof candidate.approvalPolicy !== 'string' || !APPROVAL_POLICIES.has(candidate.approvalPolicy)) throw new Error('Invalid approval policy.')
    update.approvalPolicy = candidate.approvalPolicy as DesktopComputerUpdate['approvalPolicy']
  }
  if ('rootPath' in candidate) {
    if (candidate.rootPath !== null && (typeof candidate.rootPath !== 'string' || !candidate.rootPath.trim())) throw new Error('Invalid folder.')
    update.rootPath = candidate.rootPath as string | null
  }
  return update
}

export interface ComputerIpcOptions {
  agent: ComputerAgent
  assertTrustedSender: (event: Electron.IpcMainInvokeEvent) => void
  getWindow: () => BrowserWindow | null
}

export function registerComputerIpc({ agent, assertTrustedSender, getWindow }: ComputerIpcOptions): void {
  ipcMain.handle('desktop:computer:pairing-code', (event) => {
    assertTrustedSender(event)
    return agent.createPairingCode()
  })
  ipcMain.handle('desktop:computer:get-state', (event) => {
    assertTrustedSender(event)
    return agent.state
  })
  ipcMain.handle('desktop:computer:update', async (event, value: unknown) => {
    assertTrustedSender(event)
    return agent.updateConfig(validComputerUpdate(value))
  })
  ipcMain.handle('desktop:computer:choose-folder', async (event) => {
    assertTrustedSender(event)
    const window = getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose the folder the agent may work in',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    }
    const result = window && !window.isDestroyed() ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
}

export function publishComputerState(getWindow: () => BrowserWindow | null, state: unknown): void {
  const window = getWindow()
  if (!window || window.isDestroyed()) return
  window.webContents.send('desktop:computer:state-changed', state)
}
