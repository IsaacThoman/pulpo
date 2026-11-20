import { contextBridge, ipcRenderer } from 'electron'
import type { ComputerChange, ComputerChangeDetail, ComputerFolder, ComputerResponse, DesktopComputerApi } from '@pulpo/contracts'
import type {
  DesktopCommand,
  DesktopOperatingSystem,
  DesktopSignedInAccounts,
  DesktopStoredSession,
  PulpoDesktopApi,
} from './globals'

function operatingSystem(): DesktopOperatingSystem {
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform
  return 'linux'
}

const computer: DesktopComputerApi = {
  status: () => ipcRenderer.invoke('desktop:computer:status') as ReturnType<DesktopComputerApi['status']>,
  chooseFolder: () => ipcRenderer.invoke('desktop:computer:choose-folder') as Promise<ComputerFolder | null>,
  allowFullAccess: () => ipcRenderer.invoke('desktop:computer:allow-full-access') as Promise<boolean>,
  revokeFullAccess: () => ipcRenderer.invoke('desktop:computer:revoke-full-access') as Promise<void>,
  forgetFolder: (folder) => ipcRenderer.invoke('desktop:computer:forget-folder', folder) as Promise<void>,
  forgetApp: (id) => ipcRenderer.invoke('desktop:computer:forget-app', id) as Promise<void>,
  begin: (session) => ipcRenderer.invoke('desktop:computer:begin', session) as ReturnType<DesktopComputerApi['begin']>,
  end: (sessionId) => ipcRenderer.invoke('desktop:computer:end', sessionId) as Promise<void>,
  sessions: () => ipcRenderer.invoke('desktop:computer:sessions') as Promise<string[]>,
  handle: (request) => ipcRenderer.invoke('desktop:computer:handle', request) as Promise<ComputerResponse>,
  changes: {
    list: (filter) => ipcRenderer.invoke('desktop:computer:changes:list', filter) as Promise<ComputerChange[]>,
    get: (id) => ipcRenderer.invoke('desktop:computer:changes:get', id) as Promise<ComputerChangeDetail | null>,
    accept: (ids, options) => ipcRenderer.invoke('desktop:computer:changes:accept', ids, options) as Promise<ComputerChange[]>,
    reject: (ids) => ipcRenderer.invoke('desktop:computer:changes:reject', ids) as Promise<ComputerChange[]>,
    onChanged: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('desktop:computer:changes-changed', handler)
      return () => ipcRenderer.removeListener('desktop:computer:changes-changed', handler)
    },
  },
}

const api: PulpoDesktopApi = {
  platform: 'desktop',
  os: operatingSystem(),
  session: {
    load: () => ipcRenderer.invoke('desktop:session:load') as Promise<DesktopStoredSession | null>,
    store: (session) => ipcRenderer.invoke('desktop:session:store', session) as Promise<void>,
    clear: () => ipcRenderer.invoke('desktop:session:clear') as Promise<void>,
  },
  accounts: {
    load: () => ipcRenderer.invoke('desktop:accounts:load') as Promise<DesktopSignedInAccounts | null>,
    store: (accounts) => ipcRenderer.invoke('desktop:accounts:store', accounts) as Promise<void>,
  },
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url) as Promise<void>,
  onProtocolUrl: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => listener(url)
    ipcRenderer.on('desktop:protocol-url', handler)
    return () => ipcRenderer.removeListener('desktop:protocol-url', handler)
  },
  onCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: DesktopCommand) => listener(command)
    ipcRenderer.on('desktop:command', handler)
    return () => ipcRenderer.removeListener('desktop:command', handler)
  },
  setFilesTabsMenu: (shown) => ipcRenderer.invoke('desktop:menu:files-tabs', shown) as Promise<void>,
  appInfo: () => ipcRenderer.invoke('desktop:app-info') as Promise<{ name: string; version: string; packaged: boolean }>,
  windowControls: {
    minimize: () => ipcRenderer.invoke('desktop:window:minimize') as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke('desktop:window:toggle-maximize') as Promise<boolean>,
    close: () => ipcRenderer.invoke('desktop:window:close') as Promise<void>,
    isMaximized: () => ipcRenderer.invoke('desktop:window:is-maximized') as Promise<boolean>,
    onMaximizedChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
      ipcRenderer.on('desktop:window:maximized-changed', handler)
      return () => ipcRenderer.removeListener('desktop:window:maximized-changed', handler)
    },
  },
  computer,
}

contextBridge.exposeInMainWorld('pulpoDesktop', api)
